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
			else if (e.t === "say") { cur.say = e; (cur.says ??= []).push(e); }
		}
	}
	return steps;
}

/**
 * Review navigation shared with the chat. key: left|right|end|esc; mutates ui ({sel, top, seen}).
 * Returns "review" (reviewing a step), "live" (back to live) or "close" (esc while live).
 */
export function navigate(ui, groups, key) {
	const live = ui.sel < 0;
	if (key === "left") {
		if (live ? groups > 1 : true) { ui.sel = live ? groups - 2 : Math.max(0, ui.sel - 1); ui.top = 0; if (live) ui.seen = groups; }
	} else if (key === "right") {
		if (!live) { ui.sel++; ui.top = 0; if (ui.sel >= groups - 1) ui.sel = -1; }
	} else if (key === "end" || (key === "esc" && !live)) { ui.sel = -1; ui.top = 0; }
	else if (key === "esc") return "close";
	return ui.sel < 0 ? "live" : "review";
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

/** No readable state: say what happened and which key helps (one short block, never wider than W). */
function emptyRows(problem, W, H) {
	const bad = problem === "illeggibile";
	const lines = bad
		? [`${C.err}Stato della corsa illeggibile.${R}`, `${C.dim}Il file di stato è incompleto o rovinato; riprova tra poco.${R}`, `${C.text}q${C.dim} chiude la vista · ${C.text}/auto status${C.dim} per controllare.${R}`]
		: [`${C.warn}Nessuna corsa in questa sessione.${R}`, `${C.dim}Avviane una con ${C.text}/auto <obiettivo>${C.dim}; la vista si riempie da sola.${R}`, `${C.text}q${C.dim} chiude la vista.${R}`];
	const rows = lines.map((l) => cutAnsi(l, W));
	while (rows.length < H) rows.push("");
	return rows.slice(0, Math.max(1, H));
}

const toneColor = (tone) => ({ ok: C.ok, warn: C.warn, err: C.err }[tone] ?? C.dim);

function reqLines(state, w, events) {
	// Last check result per requirement: a failed one (not current) is red.
	const failed = new Set();
	for (const e of events) if (e.t === "check") e.ok ? failed.delete(e.id) : failed.add(e.id);
	const next = state.requirements.find((r) => !r.passes);
	const lines = [];
	for (const r of state.requirements) {
		const mark = r.passes ? `${C.ok}✓` : r === next ? `${C.cyan}▸` : failed.has(r.id) ? `${C.err}✖` : `${C.faint}○`;
		lines.push({ focus: r === next, text: `${mark} ${r.passes ? C.dim : C.text}${fit(`${r.id} ${r.descrizione}`, w - 2)}${R}` });
	}
	return lines;
}

const MAX_TOOLS = 5;

const PHASES = ["define", "plan", "build", "verify", "review", "ship"]; // PHASES in extensions/auto/policy.ts
const PHASE_IT = { define: "definisci", plan: "pianifica", build: "costruisci", verify: "verifica", review: "rivedi", ship: "consegna" };
const READ_TOOLS = new Set(["read", "grep", "glob", "find", "ls", "web_search", "web_fetch", "fetch"]);
const skillOf = (arg) => (/(^|\/)SKILL\.md$/.test(arg) ? arg.split("/").slice(-2, -1)[0] : undefined);
const section = (title, w, extra = "") => `${C.faint}── ${C.cyan}${title}${extra ? `${C.dim} ${extra}` : ""} ${C.faint}${"─".repeat(Math.max(0, w - title.length - visible(extra).length - 5))}${R}`;

/** FASI: one row per phase with its steps and time; the current one is marked. */
export function phaseLines(state, groups, w) {
	const cur = PHASES.indexOf(state.phase);
	const done = state.stop?.reason === "completato";
	return PHASES.map((p, i) => {
		const gs = groups.filter((g) => g.phase === p);
		const ms = gs.reduce((a, g) => a + (g.end?.ms ?? 0), 0);
		const mark = done || i < cur ? `${C.ok}✓` : i === cur ? `${C.mag}▸` : `${C.faint}○`;
		const info = gs.length ? `${gs.length}p${ms ? ` ${fmtDur(ms)}` : ""}` : "";
		const name = PHASE_IT[p];
		return `${mark} ${i === cur && !done ? `${C.b}${C.text}` : i < cur || done ? C.dim : C.faint}${padTo(fit(name, Math.max(4, w - 9)), Math.min(10, Math.max(4, w - 9)))}${C.faint} ${fit(info, 8)}${R}`;
	});
}

/** PENSIERO: what the model is writing/thinking right now (last diary "say" of the step), wrapped. */
export function thoughtLines(g, w, max, running) {
	const say = g?.say;
	if (!say) return [`${C.faint}${running ? "in attesa del primo pensiero…" : "nessun pensiero registrato"}${R}`];
	const tag = say.kind === "think" ? `${C.mag}◌ ragiona` : `${C.cyan}✎ scrive`;
	const lines = wrapPlain(say.text.replace(/\s+/g, " ").trim(), Math.max(10, w - 2));
	const shown = lines.slice(-max);
	return [`${tag}${R}`, ...shown.map((l, i) => `${C.text}${i === 0 && lines.length > max ? "…" : " "}${l}${R}`)].slice(-max - 1);
}

/** STUDIO (files/sources read) and PRASSI (skills followed, tools used) of the viewed step. */
export function practiceLines(g, w) {
	if (!g) return [];
	const reads = [], skills = [], counts = new Map();
	for (const t of g.tools) {
		counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
		const sk = t.name === "read" ? skillOf(t.arg) : undefined;
		if (sk) { if (!skills.includes(sk)) skills.push(sk); }
		else if (READ_TOOLS.has(t.name)) reads.push(t);
	}
	const out = [];
	out.push(`${C.dim}studio ${C.text}${reads.length} letture${reads.length ? `${C.faint} · ultime: ${C.dim}${fit(reads.slice(-3).map((t) => t.arg.split("/").slice(-1)[0] || t.arg).join(", "), Math.max(8, w - 32))}` : ""}${R}`);
	out.push(`${C.dim}prassi ${skills.length ? `${C.ok}${fit(skills.join(" · "), Math.max(8, w - 8))}` : `${C.faint}nessuna skill`}${R}`);
	const acts = [...counts].filter(([n]) => !READ_TOOLS.has(n)).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`);
	if (acts.length) out.push(`${C.dim}azioni ${C.text}${fit(acts.join(" "), Math.max(8, w - 8))}${R}`);
	return out;
}

const TABS = ["Panoramica", "Pensiero", "Studio e prassi", "Passi"];
export const TAB_COUNT = TABS.length;

/** Tab 1: enough to answer "is it going well, and why" at a glance; wide screens put requirements on the left. */
function overviewBody(state, groups, g, events, W, room, live, running, done, total) {
	const wide = W >= 80;
	const lw = wide ? Math.min(40, Math.floor(W * 0.36)) : W, rw = wide ? W - lw - 3 : W;
	const phases = phaseLines(state, groups, lw);
	const reqs = reqLines(state, lw, events);
	const cap = Math.max(2, (wide ? room : Math.min(5, room - 8)) - (wide ? phases.length : 1) - 2);
	const at = Math.max(0, reqs.findIndex((r) => r.focus));
	const from = Math.max(0, Math.min(at - Math.floor(cap / 2), reqs.length - cap));
	const reqRows = reqs.slice(from, from + cap).map((r) => r.text);
	const oneLine = PHASES.map((p, i) => { const c = PHASES.indexOf(state.phase); return `${i < c || state.stop?.reason === "completato" ? C.ok : i === c ? C.mag : C.faint}${PHASE_IT[p].slice(0, 4)}`; }).join(`${C.faint} › `);
	const left = [section("FASI", lw), ...(wide ? phases : [oneLine + R]), section("REQUISITI", lw, `${done}/${total}`), ...reqRows];
	const tools = (g?.tools ?? []).slice(-3).map((t) => `${C.dim}▸ ${C.text}${t.name}${C.faint} ${fit(t.arg, rw - t.name.length - 3)}${R}`);
	const rrow = wide ? room : Math.max(6, room - left.length - 1);
	const think = thoughtLines(g, rw, Math.max(2, Math.min(5, rrow - 6)), running);
	const right = [section("PENSIERO", rw, live && running ? "in diretta" : ""), ...think, section("ULTIMI TOOL", rw), ...tools];
	const body = [];
	if (wide) for (let i = 0; i < room; i++) body.push(`${padTo2(left[i] ?? "", lw)}${C.faint} │ ${R}${right[i] ?? ""}`);
	else body.push(...left, ...right);
	return body.slice(0, room);
}

/** Tab 3: what the whole run read (counted, no repeats), the skills followed, the actions taken; the viewed step is marked. */
function practiceFull(groups, g, w) {
	if (!groups.length) return [`${C.faint}nessun passo ancora${R}`];
	const reads = new Map(), acts = new Map(), skills = new Map();
	for (const x of groups) for (const t of x.tools) {
		const sk = t.name === "read" ? skillOf(t.arg) : undefined;
		const m = sk ? skills : READ_TOOLS.has(t.name) ? reads : acts;
		const key = sk ?? `${t.name} ${t.arg}`;
		const cur = m.get(key) ?? { n: 0, here: false };
		cur.n++; if (x === g) cur.here = true;
		m.set(key, cur);
	}
	const list = (m) => [...m].map(([k, v]) => `${v.here ? `${C.cyan}•` : " "} ${C.text}${fit(k, w - 10)}${v.n > 1 ? `${C.dim} ×${v.n}` : ""}${R}`);
	return [`${C.cyan}prassi${C.dim} (${skills.size})${R}`, ...(skills.size ? list(skills) : [`${C.faint}  nessuna skill letta${R}`]), "", `${C.cyan}studio${C.dim} (${reads.size})${R}`, ...list(reads), "", `${C.cyan}azioni${C.dim} (${acts.size})${R}`, ...list(acts), `${C.faint}• = nel passo che stai guardando${R}`];
}

/** Whole thought history of the step, oldest first (the tab shows the newest rows). */
function thoughtHistory(g, w, running) {
	const says = g?.says ?? [];
	if (!says.length) return thoughtLines(g, w, 1, running);
	const out = [];
	for (const e of says) {
		out.push(`${e.kind === "think" ? `${C.mag}◌ ragiona` : `${C.cyan}✎ scrive`}${C.faint} ${clock(e.at)}${R}`);
		for (const l of wrapPlain(e.text.replace(/\s+/g, " ").trim(), Math.max(10, w - 2))) out.push(`${C.text} ${l}${R}`);
	}
	return out;
}

/** Tab 4: one row per step (outcome, time), then the detail of the viewed one. */
function stepsBody(groups, g, running, W, room, ui, live) {
	const idx = groups.indexOf(g);
	const list = groups.map((x, i) => {
		const res = !x.end ? (running && i === groups.length - 1 ? `${C.mag}in corso` : `${C.dim}interrotto`) : x.end.ok ? `${C.ok}✓ ${fmtDur(x.end.ms)}` : `${C.err}✖ ${fmtDur(x.end.ms ?? 0)}`;
		return `${i === idx ? `${C.cyan}▸` : " "} ${C.text}${String(x.n || "·").padStart(2)} ${C.dim}${padTo(x.phase, 9)}${R}${res}${R}`;
	});
	const cap = Math.max(3, Math.min(list.length, Math.floor(room / 3)));
	const from = Math.max(0, Math.min(idx - Math.floor(cap / 2), list.length - cap));
	return [section("PASSI", W, `${groups.length}`), ...list.slice(from, from + cap), section("DETTAGLIO", W), ...stepLines(g, W, running)];
}

function stepLines(g, w, running) {
	if (!g) return [`${C.dim}nessun passo ancora${R}`];
	const lines = [];
	const state = !g.end ? (running ? `${C.mag}in corso…` : `${C.dim}interrotto`) : g.end.ok ? `${C.ok}✓ esito: riuscito · ${fmtDur(g.end.ms)} · ${Math.round(g.end.tokens / 1000)}k token` : `${C.err}✖ esito: ${fit(g.end.error ?? "fallito", Math.max(8, w - 24))} · ${fmtDur(g.end.ms ?? 0)} · ${Math.round((g.end.tokens ?? 0) / 1000)}k token`;
	lines.push(`${C.b}${C.text}${g.n ? `passo ${g.n} · ${g.phase}` : "controlli"}${R}  ${state}${R}`);
	// Only the last MAX_TOOLS tools: older ones collapse into a count.
	if (g.tools.length > MAX_TOOLS) lines.push(`${C.faint}… ${g.tools.length - MAX_TOOLS} tool prima${R}`);
	for (const t of g.tools.slice(-MAX_TOOLS)) lines.push(`${C.dim}▸ ${C.text}${t.name}${C.faint} ${fit(t.arg, w - t.name.length - 3)}${R}`);
	for (const c of g.checks) {
		lines.push(`${c.ok ? `${C.ok}✓` : `${C.err}✖`} ${C.text}${c.id}${R}`);
		if (!c.ok && c.out) for (const l of c.out.split("\n").filter((x) => x.trim()).slice(-4)) lines.push(`${C.faint}  ${fit(l.trim(), w - 2)}${R}`);
	}
	for (const c of g.cmds) lines.push(`${C.warn}⌘ ${c.cmd}${c.text ? ` «${fit(c.text, w - 14)}»` : ""}${c.applied ? " applicato" : ""}${R}`);
	if (g.end?.text) { lines.push(""); for (const l of wrapPlain(g.end.text, w).slice(0, 8)) lines.push(`${C.dim}${l}${R}`); }
	return lines;
}

/** Header row only (the 1 s tick redraws just this when nothing else changed). */
export function cockpitHead({ state, events, now, W, usage, ui }) {
	if (!state) return [emptyRows(undefined, W, 1)[0]];
	const groups = groupSteps(events);
	const h = health(state, events, now, usage);
	const pend = pending(state, events);
	const running = !state.stop && !(state.paused && pend.pauseApplied);
	const live = ui.sel < 0 || ui.sel >= groups.length;
	return [headRow(state, events, now, W, usage, ui, groups, h, running, live, live ? groups[groups.length - 1] : groups[ui.sel])];
}

function headRow(state, events, now, W, usage, ui, groups, h, running, live, g) {
	// One header row: phase comes from the diary (last step event), falling back to the state, never "undefined".
	let phase = state.phase || "";
	for (let i = events.length - 1; i >= 0; i--) if (events[i].t === "step" && events[i].phase) { phase = events[i].phase; break; }
	phase = phase || "?";
	const idle = events.length ? now - events[events.length - 1].at : now - state.started;
	const narrowH = W < 80;
	const stuck = running && !state.paused ? `fermo ${narrowH ? "" : "da "}${fmtDur(idle)}` : "";
	const modeT = live ? (narrowH ? "DIRETTA" : "IN DIRETTA") : (narrowH ? `RIVEDI ${g.n || "0"}/${groups.length}` : `RIVEDI passo ${g.n || "0"} di ${groups.length}`);
	const wideH = W >= 100;
	const phaseT = W < 50 ? "" : wideH ? `fase ${phase}` : phase;
	const fixed = [narrowH ? `${state.steps}/${MAX_STEPS}` : `passo ${state.steps}/${MAX_STEPS}`, `● ${h.word}`, stuck, modeT].filter(Boolean);
	const slugW = Math.min(state.slug.length, W >= 80 ? 16 : W >= 66 ? 8 : 4);
	const sep = `${C.dim} · `;
	// Below 50 columns the phase is dropped first.
	return cutAnsi(`${C.mag}${C.b}AUTO${R} ${C.text}${fit(state.slug, slugW)}${phaseT ? `${sep}${C.dim}${phaseT}` : ""}${sep}${C.dim}${fixed[0]}${sep}${toneColor(h.tone)}${C.b}${fixed[1]}${R}${C.dim}${stuck ? `${sep}${stuck}` : ""}${sep}${R}${live ? C.ok : C.cyan}${modeT}${R}`, W);
}

/**
 * Rows of the view (exactly H, each at most W visible columns).
 * ui: {sel: index of the reviewed step or -1 for live, top: scroll in review, seen: steps count when review began, note: text being typed or null}.
 */
export function cockpitRows({ state, events, now, W, H, usage, ui, problem, chat }) {
	if (!state) return emptyRows(problem, W, H);
	const chatRows = chatLines(chat, W, Math.min(10, Math.max(0, H - 16)));
	const groups = groupSteps(events);
	const h = health(state, events, now, usage);
	const pend = pending(state, events);
	const running = !state.stop && !(state.paused && pend.pauseApplied);
	const live = ui.sel < 0 || ui.sel >= groups.length;
	const g = live ? groups[groups.length - 1] : groups[ui.sel];
	const done = state.requirements.filter((r) => r.passes).length, total = state.requirements.length;
	const rows = [];
	rows.push(headRow(state, events, now, W, usage, ui, groups, h, running, live, g));
	const bar = total ? `${"▰".repeat(Math.round((done / total) * 16))}${"▱".repeat(16 - Math.round((done / total) * 16))} ${done}/${total} requisiti` : "piano non ancora scritto";
	const spent = usage !== undefined && state.fiveHourStart !== undefined ? ` · 5h +${Math.round((usage - state.fiveHourStart) * 100)}%/50%` : "";
	rows.push(cutAnsi(`${C.ok}${bar}${C.dim}${spent} · fino alle ${clock(state.deadline)} (${fmtDur(state.deadline - now)}) · ${Math.round(state.tokens / 1000)}k token${R}`, W)); // cutAnsi, not fit: the row holds color codes
	rows.push(cutAnsi(`${toneColor(h.tone)}${h.word}${C.dim} · ${C.text}${h.why}${pend.list.length ? `${C.dim} · ${C.warn}in attesa: ${pend.list.join(" · ")}` : ""}${R}`, W));
	const tab = ui.tab ?? 0;
	rows.push(cutAnsi(TABS.map((t, i) => (i === tab ? `${C.b}${C.cyan}${i + 1} ${t}` : `${C.faint}${i + 1} ${t}`) + R).join("  "), W));
	const room = Math.max(3, H - rows.length - 2 - chatRows.length);
	let body;
	if (tab === 0) body = overviewBody(state, groups, g, events, W, room, live, running, done, total);
	else {
		if (tab === 1) body = [section("PENSIERO", W, live && running ? "in diretta" : ""), ...thoughtHistory(g, W, running)];
		else if (tab === 2) body = [section("STUDIO E PRASSI", W, "tutta la corsa"), ...practiceFull(groups, g, W)];
		else body = stepsBody(groups, g, running, W, room, ui, live);
		// Scroll is clamped to the content; the thought tab follows the bottom (newest) and ↑ goes back in time.
		const max = Math.max(0, body.length - room);
		const up = Math.min(ui.top ?? 0, max);
		body = tab === 1 ? body.slice(max - up, max - up + room) : body.slice(up, up + room);
	}
	rows.push(...body.map((l) => cutAnsi(l, W)));
	while (rows.length < H - 2 - chatRows.length) rows.push("");
	rows.length = Math.min(rows.length, H - 2 - chatRows.length);
	rows.push(...chatRows);
	rows.push(`${C.cyan}${fit(nextKey(state, h), W)}${R}`);
	rows.push(cutAnsi(keyHints({ state, events, ui, chat, W, live, newSteps: groups.length > (ui.seen ?? groups.length) }), W));
	return rows;
}

/**
 * Chat strip: the last messages of the conversation with the model (which can read and steer the run through its `auto` tool).
 * chat: {msgs: [{role: "user"|"assistant"|"tool", text}], typing: string|null, busy}; empty when there is nothing to show.
 */
function chatLines(chat, W, max) {
	if (!chat || !chat.open || max < 3) return [];
	const all = [];
	for (const m of chat.msgs.slice(-6)) {
		const tag = m.role === "user" ? `${C.cyan}tu › ${C.text}` : m.role === "tool" ? `${C.dim}▸ ` : `${C.mag}pi › ${C.text}`;
		wrapPlain(m.text.replace(/\s+/g, " ").trim() || "…", Math.max(10, W - 7)).forEach((l, i) => all.push(`${i ? "      " : tag}${l}${R}`));
	}
	if (chat.busy) all.push(`${C.dim}…${R}`);
	const rows = [`${C.faint}${"─".repeat(W)}${R}`, ...all.slice(-(max - 1))];
	return rows;
}

/** Last row: only the keys valid in the current state; pending commands ("in attesa") sit next to them. Pure. */
export function keyHints({ state, events = [], ui, chat, W, live, newSteps }) {
	if (chat?.typing !== null && chat?.typing !== undefined) return `${C.cyan}chat › ${C.text}${fit(chat.typing, W - 10)}${C.cyan}▌${C.dim}  ⏎ invia · esc esci dalla chat${R}`;
	if (ui.note !== null && ui.note !== undefined) return `${C.mag}nota › ${C.text}${fit(ui.note, W - 10)}${C.mag}▌${C.dim}  ⏎ invia · esc annulla${R}`;
	if (!live) return `${C.text}1-4${C.dim} schede · ${C.text}←→${C.dim} passi · ${C.text}↑↓${C.dim} scorri · ${C.text}End${C.dim} in diretta${newSteps ? ` · ${C.warn}● nuovo passo${C.dim}` : ""} · ${C.text}q${C.dim} chiudi${R}`;
	if (state.stop) return `${C.text}1-4${C.dim} schede · ${C.text}←${C.dim} passi · ${C.text}c${C.dim} chat · ${C.text}q${C.dim} chiudi${R}`;
	const wait = pending(state, events).list.map((l) => l.replace(" per il prossimo passo", ""));
	return `${C.text}p${C.dim} ${state.paused ? "riprendi" : "pausa"} · ${C.text}c${C.dim} chat · ${C.text}:${C.dim} nota · ${C.text}s${C.dim} stop${W < 56 ? "" : ` · ${C.text}1-4${C.dim} schede · ${C.text}←${C.dim} passi`} · ${C.text}q${C.dim} chiudi${wait.length ? ` · ${C.warn}in attesa: ${wait.join(" · ")}${C.dim}` : ""}${R}`;
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
	let state, mtime = 0, offset = 0, problem = "assente";
	const events = [];
	return {
		diaryPath,
		get state() { return state; },
		// Why there is no state: "assente" (no file yet) or "illeggibile" (not valid JSON); undefined once a state is loaded.
		get problem() { return state ? undefined : problem; },
		events,
		refresh() {
			let changed = false;
			try {
				const m = statSync(stateFile).mtimeMs;
				if (m !== mtime) {
					mtime = m;
					try { state = JSON.parse(readFileSync(stateFile, "utf8")); problem = undefined; } catch { problem = "illeggibile"; }
					changed = true;
				}
			} catch { if (!state) problem = "assente"; /* state mid-rename: keep the previous one */ }
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

/**
 * Local usage counters for the falsifier of the view shape (docs/architetto/auto-mode-cockpit/30-forma-vista.md).
 * Counts only; nothing leaves the machine and nothing costs tokens. One summary line per opening.
 */
export function createStats(now) {
	const s = { opened: now, tab: 0, since: now, ms: [0, 0, 0, 0], switches: 0, keys: 0, firstKeyMs: undefined, chat: 0, note: 0 };
	return {
		key(name, at) { s.keys++; if (s.firstKeyMs === undefined) s.firstKeyMs = at - s.opened; if (name === "chat") s.chat++; else if (name === "note") s.note++; },
		tab(i, at) { if (i === s.tab) return; s.ms[s.tab] += at - s.since; s.tab = i; s.since = at; s.switches++; },
		/** Summary at close; `override` is the verdict rule: more than 2 tab switches in one opening. */
		summary(at) {
			const ms = [...s.ms]; ms[s.tab] += at - s.since;
			return { at, openMs: at - s.opened, switches: s.switches, over2: s.switches > 2, ms, keys: s.keys, firstKeyMs: s.firstKeyMs ?? null, chat: s.chat, note: s.note };
		},
	};
}
