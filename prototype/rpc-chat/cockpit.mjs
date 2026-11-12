// Cockpit of auto mode: full-screen view of a /auto run, drawn from the run's state JSON and its diary (extensions/auto/diary.ts).
// Pure functions (state + events + clock in, rows out) so they are testable without a terminal; the chat only owns the keys,
// the timer (1 s, only while the view is open and the run is active) and the screen. No dependencies, no per-frame allocation
// beyond the rows, nothing here calls the model: 0 tokens.
import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import { parseDiary } from "../../extensions/auto/diary.ts";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(";");
const fg = (h) => `\x1b[38;2;${hex(h)}m`;
const R = "\x1b[0m";
const C = { text: fg("#dcdfe8"), dim: fg("#858ba0"), faint: fg("#4c5163"), mag: fg("#ff3fd8"), cyan: fg("#2ee6ff"), ok: fg("#3df2a0"), warn: fg("#f5b942"), err: fg("#ff4d6d"), b: "\x1b[1m" };
const MAX_STEPS = 60; // LIMITS.maxSteps in extensions/auto/loop.ts

const fit = (t, w) => (w <= 0 ? "" : t.length > w ? `${t.slice(0, Math.max(0, w - 1))}…` : t);
const padTo = (t, w) => t + " ".repeat(Math.max(0, w - t.length));
export const wrapPlain = (text, w) => {
	const out = [];
	for (const para of String(text).split("\n")) {
		let line = "";
		for (const word of para.split(/\s+/).filter(Boolean)) {
			if (line && line.length + 1 + word.length > w) { out.push(line); line = ""; }
			line = line ? `${line} ${word}` : word;
			while (line.length > w) { out.push(line.slice(0, w)); line = line.slice(w); }
		}
		out.push(line);
	}
	return out;
};
export const fmtDur = (ms) => {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m${String(s % 60).padStart(2, "0")}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);

/** Events grouped per step: {n, phase, at, tools, end, checks, cmds}; n = 0 collects what happens before the first step. */
export function groupSteps(events) {
	const steps = [];
	let cur;
	const open = (n, phase, at) => steps.push((cur = { n, phase, at, tools: [], checks: [], cmds: [] }));
	for (const e of events) {
		if (e.t === "step") open(e.n, e.phase, e.at);
		else {
			if (!cur) open(0, "controlli", e.at);
			if (e.t === "tool") cur.tools.push(e);
			else if (e.t === "end") cur.end = e;
			else if (e.t === "check") cur.checks.push(e);
			else if (e.t === "cmd") cur.cmds.push(e);
		}
	}
	return steps;
}

/** Commands asked but not yet applied: pause waits for the step boundary, notes for the next step. */
export function pending(state, events) {
	let pauseApplied = false;
	for (const e of events) if (e.t === "cmd") { if (e.cmd === "pausa" && e.applied) pauseApplied = true; else if (e.cmd === "riprendi") pauseApplied = false; }
	const list = [];
	if (state.paused && !pauseApplied && !state.stop) list.push("pausa al prossimo passo");
	if (state.notes?.length) list.push(`${state.notes.length === 1 ? "1 nota" : `${state.notes.length} note`} per il prossimo passo`);
	return { list, pauseApplied };
}

/** One word and the reason. Thresholds from the brief: stall 2/3, same error ≥3, budget or time ≥80%, 4 build steps without a green requirement. */
export function health(state, events, now, usage) {
	const stop = state.stop;
	if (stop) {
		if (["check-manomessi", "errore", "piano-non-valido"].includes(stop.reason)) return { word: "SERVE TE", why: `${stop.reason}: ${stop.detail}`, tone: "err" };
		return { word: "FERMA", why: stop.reason === "completato" ? "completato" : `${stop.reason}: ${stop.detail}`, tone: stop.reason === "completato" ? "ok" : "warn" };
	}
	if (state.paused) return pending(state, events).pauseApplied ? { word: "FERMA", why: "in pausa (p per riprendere)", tone: "warn" } : { word: "PROCEDE", why: "pausa al prossimo passo", tone: "warn" };
	const risks = [];
	if (state.stall >= 2) risks.push(`stallo ${state.stall}/3`);
	if (state.sameError >= 3) risks.push(`stesso errore ${state.sameError}/5`);
	const timeUsed = (now - state.started) / Math.max(1, state.deadline - state.started);
	if (timeUsed >= 0.8) risks.push(`tempo al ${Math.round(timeUsed * 100)}%`);
	if (usage !== undefined && state.fiveHourStart !== undefined) {
		const spent = (usage - state.fiveHourStart) / 0.5;
		if (spent >= 0.8) risks.push(`budget 5h al ${Math.round(spent * 100)}%`);
	}
	let sinceGreen = 0, prev = 0;
	const seen = new Map();
	for (const e of events) {
		if (e.t === "step" && e.phase === "build") sinceGreen++;
		else if (e.t === "check") { seen.set(e.id, e.ok); const n = [...seen.values()].filter(Boolean).length; if (n > prev) sinceGreen = 0; prev = n; }
	}
	if (sinceGreen >= 4) risks.push(`${sinceGreen} passi build senza un requisito verde`);
	if (risks.length) return { word: "A RISCHIO", why: risks.join(" · "), tone: "warn" };
	return { word: "PROCEDE", why: "nessun segnale di rischio", tone: "ok" };
}

/** What to do next, per state of the run (one line). */
export function nextKey(state, h) {
	if (state.stop) {
		if (state.stop.reason === "completato") return "Rivedi il branch e integralo con /land dal worktree.";
		if (h.word === "SERVE TE") return "Serve te: guarda il dettaglio con q, poi /auto resume " + state.slug + " quando è a posto.";
		return `Riprendi con /auto resume ${state.slug} (q chiude la vista).`;
	}
	if (state.paused) return "In pausa: p riprende la corsa.";
	if (h.word === "A RISCHIO") return "A rischio: una nota (:) può cambiare strada; s ferma la corsa.";
	return "Niente da fare: lascia andare. : aggiunge una nota al prossimo passo.";
}

const toneColor = (tone) => ({ ok: C.ok, warn: C.warn, err: C.err }[tone] ?? C.dim);

function reqLines(state, w) {
	const next = state.requirements.find((r) => !r.passes);
	const lines = [];
	for (const r of state.requirements) {
		const mark = r.passes ? `${C.ok}✓` : r === next ? `${C.cyan}▸` : `${C.faint}○`;
		lines.push({ focus: r === next, text: `${mark} ${r.passes ? C.dim : C.text}${fit(`${r.id} ${r.descrizione}`, w - 2)}${R}` });
	}
	return lines;
}

function stepLines(g, w, running) {
	if (!g) return [`${C.dim}nessun passo ancora${R}`];
	const lines = [];
	const state = !g.end ? (running ? `${C.mag}in corso…` : `${C.dim}interrotto`) : g.end.ok ? `${C.ok}✓ ${fmtDur(g.end.ms)} · ${Math.round(g.end.tokens / 1000)}k token` : `${C.err}✖ ${fit(g.end.error ?? "fallito", w - 24)}`;
	lines.push(`${C.b}${C.text}${g.n ? `passo ${g.n} · ${g.phase}` : "controlli"}${R}  ${state}${R}`);
	for (const t of g.tools) lines.push(`${C.dim}▸ ${C.text}${t.name}${C.faint} ${fit(t.arg, w - t.name.length - 3)}${R}`);
	for (const c of g.checks) {
		lines.push(`${c.ok ? `${C.ok}✓` : `${C.err}✖`} ${C.text}${c.id}${R}`);
		if (!c.ok && c.out) for (const l of c.out.split("\n").filter((x) => x.trim()).slice(-4)) lines.push(`${C.faint}  ${fit(l.trim(), w - 2)}${R}`);
	}
	for (const c of g.cmds) lines.push(`${C.warn}⌘ ${c.cmd}${c.text ? ` «${fit(c.text, w - 14)}»` : ""}${c.applied ? " applicato" : ""}${R}`);
	if (g.end?.text) { lines.push(""); for (const l of wrapPlain(g.end.text, w).slice(0, 8)) lines.push(`${C.dim}${l}${R}`); }
	return lines;
}

/**
 * Rows of the view (exactly H, each at most W visible columns).
 * ui: {sel: index of the reviewed step or -1 for live, top: scroll in review, seen: steps count when review began, note: text being typed or null}.
 */
export function cockpitRows({ state, events, now, W, H, usage, ui, chat }) {
	const chatRows = chatLines(chat, W, Math.min(7, Math.max(0, H - 16)));
	const groups = groupSteps(events);
	const h = health(state, events, now, usage);
	const pend = pending(state, events);
	const running = !state.stop && !(state.paused && pend.pauseApplied);
	const live = ui.sel < 0 || ui.sel >= groups.length;
	const g = live ? groups[groups.length - 1] : groups[ui.sel];
	const done = state.requirements.filter((r) => r.passes).length, total = state.requirements.length;
	const rows = [];
	const mode = live ? `${C.ok}IN DIRETTA` : `${C.cyan}RIVEDI passo ${g.n || "0"}/${groups.length}`;
	rows.push(`${C.mag}${C.b}AUTO${R} ${C.text}${fit(state.slug, Math.max(8, W - 48))}${C.dim} · fase ${state.phase} · passo ${state.steps}/${MAX_STEPS} · ${R}${mode}${R}`);
	const idle = events.length ? now - events[events.length - 1].at : now - state.started;
	rows.push(`${toneColor(h.tone)}${C.b}● ${h.word}${R}${C.dim} ${fit(h.why, W - 14)}${running && !state.paused && W >= 60 ? ` · fermo da ${fmtDur(idle)}` : ""}${R}`);
	const bar = total ? `${"▰".repeat(Math.round((done / total) * 16))}${"▱".repeat(16 - Math.round((done / total) * 16))} ${done}/${total} requisiti` : "piano non ancora scritto";
	const spent = usage !== undefined && state.fiveHourStart !== undefined ? ` · 5h +${Math.round((usage - state.fiveHourStart) * 100)}%/50%` : "";
	rows.push(`${C.ok}${fit(`${bar}${C.dim}${spent} · fino alle ${clock(state.deadline)} (${fmtDur(state.deadline - now)}) · ${Math.round(state.tokens / 1000)}k token`, W)}${R}`);
	rows.push(pend.list.length ? `${C.warn}in attesa: ${fit(pend.list.join(" · "), W - 12)}${R}` : "");
	rows.push(`${C.faint}${"─".repeat(W)}${R}`);
	const room = Math.max(3, H - rows.length - 2 - chatRows.length);
	const wide = W >= 80;
	const lw = wide ? Math.min(46, Math.floor(W * 0.4)) : W, rw = wide ? W - lw - 3 : W;
	const reqs = reqLines(state, lw);
	let left;
	if (reqs.length <= (wide ? room : Math.min(6, room - 3))) left = reqs.map((r) => r.text);
	else {
		const cap = wide ? room : Math.min(6, room - 3), at = Math.max(0, reqs.findIndex((r) => r.focus));
		const from = Math.max(0, Math.min(at - Math.floor(cap / 2), reqs.length - cap));
		left = reqs.slice(from, from + cap).map((r) => r.text);
	}
	let right = stepLines(g, rw, running);
	let top = 0;
	if (live) top = Math.max(0, right.length - (wide ? room : room - left.length - 1));
	else top = Math.max(0, Math.min(ui.top ?? 0, right.length - 1));
	right = right.slice(top);
	const body = [];
	if (wide) {
		for (let i = 0; i < room; i++) body.push(`${padTo2(left[i] ?? "", lw)}${C.faint} │ ${R}${right[i] ?? ""}`);
	} else {
		body.push(...left, `${C.faint}${"─".repeat(W)}${R}`, ...right);
		body.length = Math.min(body.length, room);
	}
	rows.push(...body.map((l) => cutAnsi(l, W)));
	while (rows.length < H - 2 - chatRows.length) rows.push("");
	rows.length = Math.min(rows.length, H - 2 - chatRows.length);
	rows.push(...chatRows);
	rows.push(`${C.cyan}${fit(nextKey(state, h), W)}${R}`);
	let keys;
	if (chat?.typing !== null && chat?.typing !== undefined) keys = `${C.cyan}chat › ${C.text}${fit(chat.typing, W - 10)}${C.cyan}▌${C.dim}  ⏎ invia · esc annulla${R}`;
	else if (ui.note !== null && ui.note !== undefined) keys = `${C.mag}nota › ${C.text}${fit(ui.note, W - 10)}${C.mag}▌${C.dim}  ⏎ invia · esc annulla${R}`;
	else if (!live) keys = `${C.text}←→${C.dim} passi · ${C.text}↑↓${C.dim} scorri · ${C.text}End${C.dim} in diretta${groups.length > (ui.seen ?? groups.length) ? ` · ${C.warn}● nuovo passo${C.dim}` : ""} · ${C.text}q${C.dim} chiudi${R}`;
	else if (state.stop) keys = `${C.text}←${C.dim} passi · ${C.text}q${C.dim} chiudi${R}`;
	else keys = `${C.text}p${C.dim} ${state.paused ? "riprendi" : "pausa"} · ${C.text}c${C.dim} chat · ${C.text}:${C.dim} nota · ${C.text}s${C.dim} stop · ${C.text}←${C.dim} passi · ${C.text}q${C.dim} chiudi${R}`;
	rows.push(keys);
	return rows;
}

/**
 * Chat strip: the last messages of the conversation with the model (which can read and steer the run through its `auto` tool).
 * chat: {msgs: [{role: "user"|"assistant"|"tool", text}], typing: string|null, busy}; empty when there is nothing to show.
 */
function chatLines(chat, W, max) {
	if (!chat || max < 3 || (!chat.msgs.length && (chat.typing === null || chat.typing === undefined))) return [];
	const all = [];
	for (const m of chat.msgs.slice(-6)) {
		const tag = m.role === "user" ? `${C.cyan}tu › ${C.text}` : m.role === "tool" ? `${C.dim}▸ ` : `${C.mag}pi › ${C.text}`;
		wrapPlain(m.text.replace(/\s+/g, " ").trim() || "…", Math.max(10, W - 7)).forEach((l, i) => all.push(`${i ? "      " : tag}${l}${R}`));
	}
	if (chat.busy) all.push(`${C.dim}…${R}`);
	const rows = [`${C.faint}${"─".repeat(W)}${R}`, ...all.slice(-(max - 1))];
	return rows;
}

// Left cells hold ANSI codes: pad by visible width.
const visible = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");
const padTo2 = (t, w) => t + " ".repeat(Math.max(0, w - visible(t).length));
// Cut a colored row at W visible columns (rows are built from already fitted parts; this is the last safety).
function cutAnsi(line, W) {
	if (visible(line).length <= W) return line;
	let n = 0, out = "";
	for (const m of line.matchAll(/\x1b\[[0-9;]*m|[^\x1b]/gu)) {
		if (m[0][0] === "\x1b") { out += m[0]; continue; }
		if (n >= W - 1) break;
		out += m[0]; n++;
	}
	return `${out}…${R}`;
}

/**
 * Feeds the view: reads the state JSON and, incrementally, the diary. refresh() returns true when something changed.
 * The path is the state file announced by /auto with setStatus("auto-run", path).
 */
export function createFeed(stateFile) {
	const diaryPath = stateFile.replace(/\.json$/, ".eventi.jsonl");
	let state, mtime = 0, offset = 0;
	const events = [];
	return {
		diaryPath,
		get state() { return state; },
		events,
		refresh() {
			let changed = false;
			try {
				const m = statSync(stateFile).mtimeMs;
				if (m !== mtime) { mtime = m; state = JSON.parse(readFileSync(stateFile, "utf8")); changed = true; }
			} catch { /* state mid-rename: keep the previous one */ }
			if (existsSync(diaryPath)) {
				try {
					const size = statSync(diaryPath).size;
					if (size < offset) { offset = 0; events.length = 0; changed = true; }
					if (size > offset) {
						const fd = openSync(diaryPath, "r");
						const buf = Buffer.alloc(size - offset);
						readSync(fd, buf, 0, buf.length, offset);
						closeSync(fd);
						// Only whole lines are consumed (byte offset): a half-written last line waits for the next read.
						const end = buf.lastIndexOf(10) + 1;
						if (end) { offset += end; events.push(...parseDiary(buf.subarray(0, end).toString("utf8"))); changed = true; }
					}
				} catch { /* the next tick retries */ }
			}
			return changed;
		},
	};
}
