#!/usr/bin/env node
// Prototype: a chat UI written from scratch on top of `pi --mode rpc` (no pi-tui, no dependencies).
// Differential rendering: only the rows that changed are written; streaming redraws are capped (PROTO_FPS, default 30),
// key presses redraw at once. Usage: node chat.mjs [pi options, e.g. --model haiku]
import { spawn, execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FPS = Number(process.env.PROTO_FPS) || 30;
const piArgs = ["--mode", "rpc", "--no-session", ...process.argv.slice(2)];
const env = { ...process.env };
delete env.NODE_OPTIONS;
const child = spawn("pi", piArgs, { stdio: ["pipe", "pipe", "inherit"], env });

const out = process.stdout;
const ESC = "\x1b[";
const R = "\x1b[0m";

// --- Theme: Neon Night (same palette as pi-ui/themes/neon-night.json).
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(";");
const fg = (h) => `\x1b[38;2;${hex(h)}m`;
const bg = (h) => `\x1b[48;2;${hex(h)}m`;
const P = { text: "#dcdfe8", dim: "#858ba0", faint: "#4c5163", border: "#2e3140", mag: "#ff3fd8", cyan: "#2ee6ff", yel: "#f5e14a", ok: "#3df2a0", warn: "#f5b942", err: "#ff4d6d", userBg: "#1c1326", codeBg: "#16161f", panel: "#13121a" };
const S = { text: fg(P.text), dim: fg(P.dim), faint: fg(P.faint), mag: fg(P.mag), cyan: fg(P.cyan), yel: fg(P.yel), ok: fg(P.ok), warn: fg(P.warn), err: fg(P.err), b: "\x1b[1m", i: "\x1b[3m", u: "\x1b[4m" };

// --- State.
const blocks = []; // {kind: user|assistant|thinking|tool, text, ...}
let open; // block being streamed
let running = false, startedAt = 0;
const tokens = { out: 0 };
let input = "", cursor = 0, scroll = 0, frames = 0;
let model = "", ctxPct, cost, toast = "", dialog, title = "pi";
const statuses = new Map(), widgets = new Map();
let expandSteps = false;
const git = { branch: "", files: [] };
let commands = [{ name: "quit", description: "esci" }, { name: "clear", description: "pulisci la vista" }, { name: "new", description: "nuova sessione" }, { name: "compact", description: "compatta il contesto" }];
let projectFiles = [];
const hist = []; let hIdx = 0, draft = "";
let popSel = 0, popDismissed = "";

const append = (kind, delta) => {
	if (!open || open.kind !== kind) {
		open = { kind, text: "" };
		blocks.push(open);
	}
	open.text += delta;
};

// --- Text measuring and ANSI-aware wrapping.
const ANSI = /\x1b\[[0-9;]*m/y;
const STRIP = /\x1b\[[0-9;]*m/g;
// Column width of a code point: combining/zero-width 0, East Asian wide and emoji 2.
const cw = (cp) =>
	(cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f ? 0
	: (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd) ? 2
	: 1;
const width_ = (t) => { let w = 0; for (const ch of t.replace(STRIP, "")) w += cw(ch.codePointAt(0)); return w; };
const pad = (line, w) => line + " ".repeat(Math.max(0, w - width_(line)));
// Cut a styled line to `w` visible columns (ANSI kept, reset appended when cut).
const cut = (line, w) => {
	if (line.length <= w && !/[^\x00-\u02ff]/.test(line) && !line.includes("\x1b")) return line;
	let res = "", vis = 0;
	for (let i = 0; i < line.length; ) {
		ANSI.lastIndex = i;
		const m = ANSI.exec(line);
		if (m) { res += m[0]; i += m[0].length; continue; }
		const cp = line.codePointAt(i), ch = String.fromCodePoint(cp), cwid = cw(cp);
		if (vis + cwid > w) return res + R;
		res += ch; vis += cwid; i += ch.length;
	}
	return res;
};

// Wrap one styled line to `width` visible columns; open SGR state is carried over; `hang` indents continuation lines.
const wrapAnsi = (line, width, hang = 0) => {
	if (!line.includes("\x1b") && line.length <= width && !/[^\x00-\u02ff]/.test(line)) return [line];
	const rowsOut = [];
	const ind = " ".repeat(Math.min(hang, Math.max(0, width - 8)));
	let cur = "", vis = 0, active = "", lastSpace = -1, lastSpaceVis = 0;
	for (let i = 0; i < line.length; ) {
		ANSI.lastIndex = i;
		const m = ANSI.exec(line);
		if (m) {
			cur += m[0];
			active = m[0] === "\x1b[0m" ? "" : active + m[0];
			i += m[0].length;
			continue;
		}
		const cp = line.codePointAt(i);
		const ch = String.fromCodePoint(cp);
		const w = cw(cp);
		if (vis + w > width) {
			if (lastSpace > 0) {
				rowsOut.push(cur.slice(0, lastSpace) + (active ? R : ""));
				cur = active + ind + cur.slice(lastSpace + 1);
				vis = ind.length + (vis - lastSpaceVis - 1);
			} else {
				rowsOut.push(cur + (active ? R : ""));
				cur = active + ind;
				vis = ind.length;
			}
			lastSpace = -1;
		}
		if (ch === " ") { lastSpace = cur.length; lastSpaceVis = vis; }
		cur += ch;
		vis += w;
		i += ch.length;
	}
	rowsOut.push(cur);
	return rowsOut;
};
const wrap = (text, width, hang = 0) => text.split("\n").flatMap((l) => (l ? wrapAnsi(l, width, hang) : [""]));
// Character-based wrap for the prompt (so the caret maths matches exactly).
const hardWrap = (text, width) => {
	const lines = [];
	for (const part of text.split("\n")) {
		let cur = "", vis = 0;
		for (const ch of part) {
			const w = cw(ch.codePointAt(0));
			if (vis + w > width) { lines.push(cur); cur = ""; vis = 0; }
			cur += ch; vis += w;
		}
		lines.push(cur);
	}
	return lines;
};


// --- Charts: a ```grafico block with JSON {tipo, titolo, etichette, serie:[{nome, valori}], unita} (same format Pi's UI draws).
const EIGHTHS = " ▏▎▍▌▋▊▉█", LEVELS = "▁▂▃▄▅▆▇█";
const SERIES = [S.cyan, S.mag, S.yel, S.ok];
const fmt = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
const bar = (frac, cells) => { const eighths = Math.round(Math.max(0, Math.min(1, frac)) * cells * 8); return "█".repeat(Math.floor(eighths / 8)) + (eighths % 8 ? EIGHTHS[eighths % 8] : ""); };
const chart = (spec, width) => {
	const series = (spec.serie ?? (Array.isArray(spec.valori) ? [{ nome: spec.nome, valori: spec.valori }] : [])).filter((x) => Array.isArray(x.valori)).slice(0, 4);
	if (!series.length) return undefined;
	const labels = spec.etichette ?? series[0].valori.map((_, i) => String(i + 1));
	const unit = spec.unita ? ` ${spec.unita}` : "";
	const all = series.flatMap((x) => x.valori.filter(Number.isFinite));
	const max = Math.max(...all, 0), min = Math.min(...all, 0), span = max - min || 1;
	const out = [];
	if (spec.titolo) out.push(`${S.b}${S.text}${spec.titolo}${R}`);
	if (series.length > 1) out.push(series.map((x, i) => `${SERIES[i]}■${S.dim} ${x.nome ?? `serie ${i + 1}`}`).join("  ") + R);
	const lw = Math.min(16, Math.max(...labels.map((l) => width_(String(l)))));
	if (spec.tipo === "linee") {
		for (const [i, x] of series.entries()) {
			const spark = x.valori.map((v) => LEVELS[Math.max(0, Math.min(7, Math.round(((v - min) / span) * 7)))]).join("");
			out.push(`${SERIES[i]}${cut(spark, width - 24)}${S.dim}  ${fmt(Math.min(...x.valori))}…${fmt(Math.max(...x.valori))}${unit}${series.length > 1 ? "" : ""}${R}`);
		}
		out.push(`${S.faint}${cut(labels.join(" · "), width)}${R}`);
	} else if (spec.tipo === "barre") {
		const rowsH = 6, n = labels.length, group = series.length, colW = Math.max(group, Math.min(8, Math.floor((width - 2) / Math.max(1, n)) - 1));
		for (let r = rowsH - 1; r >= 0; r--) {
			let line = "";
			for (let c = 0; c < n; c++) {
				let cell = "";
				for (const [i, x] of series.entries()) {
					const v = x.valori[c] ?? 0, h = ((v - Math.min(min, 0)) / (max - Math.min(min, 0) || 1)) * rowsH;
					const part = Math.max(0, Math.min(1, h - r)), ch = part <= 0 ? " " : LEVELS[Math.max(0, Math.round(part * 8) - 1)];
					cell += `${SERIES[i]}${ch.repeat(Math.max(1, Math.floor(colW / group)))}`;
				}
				line += pad(cell + R, colW + 1);
			}
			out.push(cut(line, width));
		}
		out.push(`${S.faint}${cut(labels.map((l) => pad(String(l).slice(0, colW), colW + 1)).join(""), width)}${R}`);
		out.push(`${S.dim}max ${fmt(max)}${unit}${R}`);
	} else {
		const room = Math.max(6, width - lw - 14);
		for (let c = 0; c < labels.length; c++)
			for (const [i, x] of series.entries()) {
				const v = x.valori[c] ?? 0;
				out.push(`${S.dim}${i === 0 ? pad(String(labels[c]).slice(0, lw), lw) : " ".repeat(lw)} ${SERIES[i]}${pad(bar(v / (max || 1), room), room)}${S.text} ${fmt(v)}${unit}${R}`);
			}
	}
	return out.map((l) => cut(l, width));
};

// --- Markdown (line based, streaming friendly).
const inline = (t) =>
	t
		.replace(/`([^`]+)`/g, `${fg("#ffb86c")}$1${S.text}`)
		.replace(/\[([^\]]+)\]\(https?:[^)\s]+\)/g, `${S.u}${S.cyan}$1${R}${S.text}`)
		.replace(/\*\*([^*]+)\*\*/g, `${S.b}$1\x1b[22m`)
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, `$1${S.i}$2\x1b[23m`);

const tableRows = (rowsText, width) => {
	const cells = rowsText.map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())));
	const sep = (r) => r.every((c) => /^:?-{2,}:?$/.test(c.replace(STRIP, "")));
	const body = cells.filter((r) => !sep(r));
	const n = Math.max(...body.map((r) => r.length));
	const widths = Array.from({ length: n }, (_, i) => Math.max(...body.map((r) => width_(r[i] ?? ""))));
	const total = () => widths.reduce((a, b) => a + b, 0) + 3 * (n - 1);
	while (total() > width && Math.max(...widths) > 6) widths[widths.indexOf(Math.max(...widths))]--;
	return body.map((r, ri) => {
		const line = widths.map((w, i) => pad(cut(r[i] ?? "", w), w)).join(`${S.faint} │ ${S.text}`);
		return ri === 0 ? `${S.b}${S.mag}${line.replace(STRIP, "")}${R}` : `${S.text}${line}${R}`;
	}).concat([]).flatMap((l, ri) => (ri === 0 ? [l, `${S.faint}${widths.map((w) => "─".repeat(w)).join("─┼─")}${R}`] : [l]));
};

const markdown = (text, width) => {
	const res = [];
	const lines = text.split("\n");
	let fence = false, lang = "";
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		let m;
		if (!fence && (m = /^```\s*grafico\s*$/.exec(raw))) {
			let j = i + 1;
			while (j < lines.length && !/^```/.test(lines[j])) j++;
			if (j < lines.length) { // closed: draw it, a broken JSON falls back to a code block
				let drawn;
				try { drawn = chart(JSON.parse(lines.slice(i + 1, j).join("\n")), width); } catch {}
				if (drawn) { res.push(...drawn); i = j; continue; }
			} else { res.push(`${S.dim}▁▃▅ grafico…${R}`); break; }
		}
		if ((m = /^```\s*(\S*)/.exec(raw))) {
			fence = !fence;
			if (fence) { lang = m[1]; res.push(`${bg(P.codeBg)}${S.faint}${pad(`╭ ${lang || "code"}`, width)}${R}`); }
			else res.push(`${bg(P.codeBg)}${S.faint}${pad("╰", width)}${R}`);
			continue;
		}
		if (fence) {
			for (const part of hardWrap(raw, width - 3)) res.push(`${bg(P.codeBg)}${S.faint}│ ${fg("#a9b8ff")}${pad(part, width - 2)}${R}`);
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(raw) && i + 1 < lines.length + 1) {
			const group = [raw];
			while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) group.push(lines[++i]);
			res.push(...tableRows(group, width).map((l) => cut(l, width)));
			continue;
		}
		if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) res.push(`${S.faint}${"─".repeat(width)}${R}`);
		else if ((m = /^(#{1,6})\s+(.*)/.exec(raw))) res.push(...wrapAnsi(`${m[1].length === 1 ? `${S.b}${S.u}${S.mag}` : m[1].length === 2 ? `${S.b}${S.mag}` : `${S.b}${S.cyan}`}${m[2]}${R}`, width));
		else if ((m = /^(\s*)[-*]\s+(.*)/.exec(raw))) res.push(...wrapAnsi(`${m[1]}${S.cyan}${m[1].length ? "◦" : "•"}${R}${S.text} ${inline(m[2])}`, width, m[1].length + 2));
		else if ((m = /^(\s*)(\d+)\.\s+(.*)/.exec(raw))) res.push(...wrapAnsi(`${m[1]}${S.cyan}${m[2]}.${R}${S.text} ${inline(m[3])}`, width, m[1].length + m[2].length + 2));
		else if ((m = /^>\s?(.*)/.exec(raw))) res.push(...wrapAnsi(`${S.mag}▎${R}${S.dim}${S.i} ${inline(m[1])}${R}`, width, 2));
		else res.push(...wrapAnsi(`${S.text}${inline(raw)}${R}`, width));
	}
	return res;
};

// --- Blocks to lines. Lines of closed blocks are cached by (block, width).
const cache = new WeakMap();
const toolName = (b) => b.name ?? "tool";
const toolLabel = (b) => {
	const a = b.args ?? {};
	const arg = a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.query ?? a.url ?? (Object.keys(a).length ? JSON.stringify(a) : "");
	return `${toolName(b)} ${String(arg).replace(/\s+/g, " ")}`;
};
const toolLine = (b, width) => {
	const mark = b.done === undefined ? `${S.yel}⠿` : b.failed ? `${S.err}✗` : `${S.ok}✓`;
	const time = b.done === undefined ? `${S.dim} …` : b.ms != null ? `${S.dim} ${b.ms}ms` : "";
	const label = cut(toolLabel(b), Math.max(10, width - 14));
	return `${mark}${R} ${S.dim}${label}${R}${time}${R}`;
};
const blockLines = (block, width) => {
	const done = block !== open && (block.kind !== "tool" || block.done !== undefined);
	const hit = cache.get(block);
	if (done && hit && hit.width === width && hit.len === block.text.length) return hit.lines;
	let lines;
	if (block.kind === "assistant") lines = markdown(block.text, width);
	else if (block.kind === "user") {
		const inner = hardWrap(block.text, width - 3);
		lines = inner.map((l) => `${bg(P.userBg)}${S.mag}▌${S.text} ${pad(l, width - 2)}${R}`);
	} else if (block.kind === "thinking") {
		const all = wrap(block.text.trim(), width - 3);
		const words = block.text.split(/\s+/).filter(Boolean).length;
		const shown = done ? [] : all.slice(-4);
		const head = done ? `◇ thought · ${words} words` : `◇ thinking · ${words} words${all.length > 4 ? ` (+${all.length - 4} above)` : ""}`;
		lines = [`${S.dim}${S.i}${head}${R}`, ...shown.map((l) => `${S.faint}┊ ${S.dim}${S.i}${l}${R}`)];
	} else lines = [toolLine(block, width)];
	lines.push("");
	if (done) cache.set(block, { width, len: block.text.length, lines });
	return lines;
};

// Consecutive tool blocks collapse into one summary line once they are done (ctrl+o expands).
const bodyLines = (width) => {
	const body = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block.kind !== "tool") { body.push(...blockLines(block, width)); continue; }
		let j = i;
		while (j + 1 < blocks.length && blocks[j + 1].kind === "tool") j++;
		const group = blocks.slice(i, j + 1);
		const live = group.some((b) => b.done === undefined);
		if (expandSteps || group.length <= 2 || live) {
			const shown = !expandSteps && group.length > 4 ? group.slice(-3) : group;
			if (shown.length < group.length) body.push(`${S.dim}⠿ ${group.length - shown.length} earlier steps · ctrl+o${R}`);
			for (const b of shown) body.push(toolLine(b, width));
		} else {
			const counts = new Map();
			for (const b of group) counts.set(toolName(b), (counts.get(toolName(b)) ?? 0) + 1);
			const failed = group.filter((b) => b.failed).length;
			const ms = group.reduce((a, b) => a + (b.ms ?? 0), 0);
			body.push(`${failed ? S.err + "✗" : S.ok + "✓"}${R} ${S.dim}${group.length} steps · ${[...counts].map(([n, c]) => `${n}×${c}`).join(" ")}${failed ? ` · ${failed} failed` : ""} · ${ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms"} (ctrl+o)${R}`);
		}
		body.push("");
		i = j;
	}
	return body;
};

// --- Completion popup: "/" commands and "@" files.
const fuzzy = (q, s) => {
	if (!q) return 1;
	const a = s.toLowerCase(), b = q.toLowerCase();
	const at = a.indexOf(b);
	if (at >= 0) return 1000 - at - (a.length - b.length) * 0.01 + (a.lastIndexOf("/") < at ? 50 : 0);
	let k = 0;
	for (const ch of a) if (ch === b[k] && ++k === b.length) return 100 - a.length * 0.1;
	return 0;
};
const popup = () => {
	if (dialog) return undefined;
	const before = input.slice(0, cursor);
	let m;
	if ((m = /^\/([^\s]*)$/.exec(before))) {
		const items = commands.map((c) => ({ s: fuzzy(m[1], c.name), name: `/${c.name}`, desc: c.description ?? "", insert: `/${c.name} `, from: 0 })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 8);
		return items.length && popDismissed !== input ? items : undefined;
	}
	if ((m = /(?:^|\s)@([^\s]*)$/.exec(before))) {
		const from = cursor - m[1].length - 1;
		const items = projectFiles.map((f) => ({ s: fuzzy(m[1], f), name: f })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => ({ ...x, desc: "", insert: `@${x.name} `, from }));
		return items.length && popDismissed !== input ? items : undefined;
	}
	return undefined;
};

// --- Side panel (wide terminals): intent, git, context, cost, extension status and widgets.
const SIDE = 34;
let sideVer = 0, sideSeen = -1, sideW = 0, sideCache = [];
const sideLines = (w) => {
	const L = [];
	const head = (t) => L.push(`${S.faint}${t}${R}`);
	const intent = statuses.get("intent");
	if (intent) { head("INTENT"); L.push(...wrap(`${S.text}${intent}${R}`, w)); L.push(""); }
	head(`GIT ${git.branch ? `${S.cyan}${git.branch}` : ""}`);
	if (!git.files.length) L.push(`${S.dim}pulito${R}`);
	for (const f of git.files.slice(0, 8)) L.push(`${f.st.includes("?") ? S.warn : S.ok}${f.st.padEnd(2)}${R} ${S.dim}${cut(f.p, w - 4)}${R}`);
	if (git.files.length > 8) L.push(`${S.dim}+${git.files.length - 8} altri${R}`);
	L.push("");
	head("CONTEXT");
	const pct = Math.max(0, Math.min(100, ctxPct ?? 0)), filled = Math.round((pct / 100) * (w - 6));
	L.push(`${pct > 80 ? S.err : pct > 60 ? S.warn : S.ok}${"▰".repeat(filled)}${S.faint}${"▱".repeat(w - 6 - filled)}${R} ${S.dim}${Math.round(pct)}%${R}`);
	if (cost != null) L.push(`${S.dim}$${cost.toFixed(2)}${R}`);
	const others = [...statuses].filter(([k]) => k !== "intent");
	if (others.length) { L.push(""); head("ESTENSIONI"); for (const [k, v] of others) L.push(...wrap(`${S.dim}${v}${R}`, w)); }
	for (const lines of widgets.values()) { L.push(""); for (const l of lines) L.push(cut(`${S.text}${l}${R}`, w)); }
	return L;
};

// --- Frame.
let previous = [];
const frame = () => {
	frames++;
	const W = out.columns || 80, H = out.rows || 24;
	const side = W >= 110 ? SIDE : 0;
	const leftW = side ? W - side - 3 : W;

	// Bottom pieces first: their height decides the chat height.
	const extra = [];
	if (dialog) {
		for (const l of `${dialog.title ?? ""}${dialog.message ? `\n${dialog.message}` : ""}`.split("\n")) extra.push(`${S.mag}${cut(l, leftW)}${R}`);
		if (dialog.method === "select") dialog.options.forEach((o, i) => extra.push(i === dialog.sel ? `${S.cyan}▸ ${o}${R}` : `  ${o}`));
		else if (dialog.method === "confirm") extra.push(`${S.dim}y = sì · n = no · esc = annulla${R}`);
		else extra.push(`› ${dialog.text}${S.dim} (invio conferma · esc annulla)${R}`);
	}
	const items = popup();
	if (items) {
		popSel = Math.min(popSel, items.length - 1);
		items.forEach((it, i) => {
			const text = `${it.name}${it.desc ? `  ${S.dim}${it.desc}` : ""}`;
			extra.push(i === popSel ? `${bg(P.userBg)}${S.cyan}▸ ${pad(cut(text, leftW - 2), leftW - 2)}${R}` : cut(`  ${S.text}${text}`, leftW) + R);
		});
	}
	if (!side) for (const lines of widgets.values()) for (const l of lines) extra.push(cut(l, leftW));
	const elapsed = running ? Math.floor((Date.now() - startedAt) / 1000) : 0;
	const bits = [running ? `${S.mag}● working ${elapsed}s` : `${S.ok}●${S.dim} idle`, model, !side && ctxPct != null ? `ctx ${Math.round(ctxPct)}%` : "", !side && cost != null ? `$${cost.toFixed(2)}` : "", ...(side ? [] : statuses.values()), toast ? `${S.warn}${toast}${S.dim}` : "", scroll ? `↑${scroll} (End)` : "", `ctrl+c ${running ? "abort" : "quit"}`].filter(Boolean);
	const status = cut(`${S.dim}${bits.join(" · ")}${R}`, leftW);
	const sepLine = `${S.faint}${"─".repeat(leftW)}${R}`;
	const wrapped = hardWrap(input, leftW - 2);
	const pre = hardWrap(input.slice(0, cursor), leftW - 2);
	const crow = pre.length - 1, ccol = width_(pre[crow]);
	const start = Math.max(0, crow - 5);
	const promptLines = wrapped.slice(start, start + 6).map((l, i) => `${S.mag}${start + i === 0 ? "›" : " "}${R} ${l}`);

	const chatRows = Math.max(1, H - extra.length - 1 - 1 - promptLines.length);
	const body = bodyLines(leftW);
	scroll = Math.max(0, Math.min(scroll, Math.max(0, body.length - chatRows)));
	const view = body.slice(Math.max(0, body.length - chatRows - scroll), body.length - scroll);
	while (view.length < chatRows) view.unshift("");

	const left = [...view.map((l) => cut(l, leftW)), ...extra, status, sepLine, ...promptLines];
	let next;
	if (side) {
		if (sideVer !== sideSeen || sideW !== SIDE) { sideCache = sideLines(SIDE - 1).map((l) => cut(l, SIDE - 1)); sideSeen = sideVer; sideW = SIDE; }
		// Only the chat rows get the panel; the status, separator and prompt rows keep the full width.
		next = left.map((l, i) => (i < view.length + extra.length ? `${pad(l, leftW)}${S.faint} │ ${R}${sideCache[i] ?? ""}` : l));
	} else next = left;
	let buf = "";
	for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) buf += `${ESC}${i + 1};1H${next[i]}${ESC}K`;
	for (let i = next.length; i < previous.length; i++) buf += `${ESC}${i + 1};1H${ESC}K`;
	buf += `${ESC}${next.length - promptLines.length + (crow - start) + 1};${3 + Math.min(ccol, leftW - 3)}H`;
	previous = next;
	if (buf) out.write(buf);
};

let timer, lastDraw = 0;
const schedule = () => {
	if (timer) return;
	const wait = Math.max(0, 1000 / FPS - (Date.now() - lastDraw));
	timer = setTimeout(() => { timer = undefined; lastDraw = Date.now(); frame(); }, wait);
};
const drawNow = () => { lastDraw = Date.now(); frame(); };

// --- RPC.
const send = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);
const refreshStats = () => send({ id: "stats", type: "get_session_stats" });
const refreshGit = () =>
	execFile("git", ["status", "--porcelain", "-b"], { timeout: 3000 }, (err, so) => {
		if (err) return;
		const ls = so.split("\n").filter(Boolean);
		git.branch = (ls[0] ?? "").replace(/^## /, "").split("...")[0];
		git.files = ls.slice(1).map((l) => ({ st: l.slice(0, 2).trim() || "?", p: l.slice(3) }));
		sideVer++;
		schedule();
	});
execFile("git", ["ls-files", "-co", "--exclude-standard"], { maxBuffer: 32 << 20, timeout: 8000 }, (err, so) => { if (!err) projectFiles = so.split("\n").filter(Boolean); });

let pending = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	pending += chunk;
	let at;
	while ((at = pending.indexOf("\n")) >= 0) {
		const line = pending.slice(0, at).replace(/\r$/, "");
		pending = pending.slice(at + 1);
		if (line) onRecord(JSON.parse(line));
	}
});
const onRecord = (r) => {
	switch (r.type) {
		case "agent_start":
			running = true; startedAt = Date.now(); open = undefined;
			break;
		case "message_update": {
			const e = r.assistantMessageEvent;
			if (e?.type === "text_delta") append("assistant", e.delta);
			else if (e?.type === "thinking_delta") append("thinking", e.delta);
			if (e?.type === "text_delta" || e?.type === "thinking_delta") tokens.out += 1;
			break;
		}
		case "tool_execution_start":
			open = undefined;
			blocks.push({ kind: "tool", id: r.toolCallId, name: r.toolName, args: r.args, text: "" });
			break;
		case "tool_execution_end": {
			open = undefined;
			const t = blocks.findLast((b) => b.id === r.toolCallId);
			if (t) { t.failed = !!r.isError; t.done = true; t.ms = r.durationMs; }
			break;
		}
		case "response":
			sideVer++;
			if (r.id === "stats" && r.success) { ctxPct = r.data?.contextUsage?.percent ?? ctxPct; cost = r.data?.cost ?? cost; }
			else if (r.id === "state" && r.success) model = r.data?.model?.id ?? model;
			else if (r.id === "cmds" && r.success) commands = [...commands, ...(r.data?.commands ?? [])].filter((c, i, a) => a.findIndex((x) => x.name === c.name) === i);
			else if (r.command === "prompt" && r.success === false) toast = `errore: ${r.error ?? "prompt rifiutato"}`;
			break;
		case "extension_ui_request": {
			const m = r.method;
			sideVer++;
			if (m === "select") dialog = { id: r.id, method: m, title: r.title, options: r.options ?? [], sel: 0 };
			else if (m === "confirm") dialog = { id: r.id, method: m, title: r.title, message: r.message };
			else if (m === "input" || m === "editor") dialog = { id: r.id, method: m, title: r.title, text: r.prefill ?? r.text ?? "" };
			else if (m === "notify") { toast = r.message; setTimeout(() => { toast = ""; schedule(); }, 5000).unref(); }
			else if (m === "setStatus") r.statusText ? statuses.set(r.statusKey, r.statusText) : statuses.delete(r.statusKey);
			else if (m === "setWidget") r.widgetLines?.length ? widgets.set(r.widgetKey, r.widgetLines) : widgets.delete(r.widgetKey);
			else if (m === "setTitle") { title = r.title ?? title; out.write(`\x1b]0;${r.title}\x07`); }
			else if (m === "set_editor_text") { input = r.text ?? ""; cursor = input.length; }
			if (dialog && dialog.id === r.id && r.timeout) setTimeout(() => { if (dialog?.id === r.id) { dialog = undefined; schedule(); } }, r.timeout).unref();
			break;
		}
		case "agent_settled":
			running = false; open = undefined;
			refreshStats(); refreshGit();
			break;
		default:
			return;
	}
	schedule();
};

const answer = (body) => { send({ type: "extension_ui_response", id: dialog.id, ...body }); dialog = undefined; };
// Keys while a dialog is open (select / confirm / input / editor); returns true when consumed.
const dialogKey = (key, csi) => {
	if (!dialog) return false;
	const d = dialog;
	if (csi === "A" && d.method === "select") d.sel = Math.max(0, d.sel - 1);
	else if (csi === "B" && d.method === "select") d.sel = Math.min(d.options.length - 1, d.sel + 1);
	else if (key === "\x1b" && !csi) answer({ cancelled: true });
	else if (key === "\r" || key === "\n") answer(d.method === "select" ? { value: d.options[d.sel] } : d.method === "confirm" ? { confirmed: true } : { value: d.text });
	else if (d.method === "confirm" && (key === "y" || key === "Y")) answer({ confirmed: true });
	else if (d.method === "confirm" && (key === "n" || key === "N")) answer({ confirmed: false });
	else if (d.text !== undefined && key === "\x7f") d.text = d.text.slice(0, -1);
	else if (d.text !== undefined && key && key >= " " && !csi) d.text += key;
	return true;
};

// --- Keyboard.
const quit = () => {
	if (process.env.PROTO_DUMP) writeFileSync(process.env.PROTO_DUMP, previous.join("\n").replace(STRIP, ""));
	try {
		const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1].split(" ");
		const mine = process.cpuUsage();
		if (process.env.PROTO_CPU)
			writeFileSync(process.env.PROTO_CPU, JSON.stringify({ frames, clientMs: Math.round((mine.user + mine.system) / 1000), rpcMs: Math.round(((Number(stat[11]) + Number(stat[12])) / 100) * 1000) }));
	} catch {}
	out.write(`${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?1049l${ESC}?25h`);
	child.stdin.end();
	setTimeout(() => process.exit(0), 200);
};
const submit = () => {
	const text = input.trim();
	if (!text) return;
	if (hist[hist.length - 1] !== text) hist.push(text);
	hIdx = hist.length; draft = "";
	input = ""; cursor = 0; scroll = 0; popDismissed = "";
	if (/^\/(quit|exit)$/.test(text)) return quit();
	if (text === "/clear") { blocks.length = 0; open = undefined; previous = []; out.write(`${ESC}2J`); return; }
	if (text === "/new") { send({ type: "new_session" }); blocks.length = 0; open = undefined; previous = []; out.write(`${ESC}2J`); return; }
	if (text === "/compact") { send({ type: "compact" }); toast = "compatto…"; return; }
	blocks.push({ kind: "user", text });
	open = undefined;
	send({ type: "prompt", message: text, ...(running ? { streamingBehavior: "followUp" } : {}) });
};
const applyPopup = (it) => { input = input.slice(0, it.from) + it.insert + input.slice(cursor); cursor = it.from + it.insert.length; popDismissed = ""; };
const wordLeft = () => { let i = cursor; while (i > 0 && /\s/.test(input[i - 1])) i--; while (i > 0 && !/\s/.test(input[i - 1])) i--; return i; };
const wordRight = () => { let i = cursor; while (i < input.length && /\s/.test(input[i])) i++; while (i < input.length && !/\s/.test(input[i])) i++; return i; };
const insert = (t) => { input = input.slice(0, cursor) + t + input.slice(cursor); cursor += t.length; popSel = 0; };
const page = () => Math.max(1, (out.rows || 24) - 6);
const histMove = (dir) => {
	if (dir < 0 && hIdx > 0) { if (hIdx === hist.length) draft = input; hIdx--; input = hist[hIdx]; cursor = input.length; }
	else if (dir > 0 && hIdx < hist.length) { hIdx++; input = hIdx === hist.length ? draft : hist[hIdx]; cursor = input.length; }
};

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
	const re = /\x1b\[200~([\s\S]*?)\x1b\[201~|\x1b\[<(\d+);\d+;\d+[Mm]|\x1b\[([0-9;]*)([A-Za-z~])|(\x1b[\r\n])|([\s\S])/gu;
	let m;
	while ((m = re.exec(data))) {
		if (m[1] !== undefined) { // bracketed paste: literal text, newlines kept
			const t = m[1].replace(/\r\n?/g, "\n");
			if (dialog?.text !== undefined) dialog.text += t.replace(/\n/g, " ");
			else if (!dialog) insert(t);
		} else if (m[2] !== undefined) { // SGR mouse: 64 wheel up, 65 wheel down
			if (m[2] === "64") scroll += 3;
			else if (m[2] === "65") scroll = Math.max(0, scroll - 3);
		} else if (m[4] !== undefined) {
			if (dialogKey(undefined, m[3] + m[4])) continue;
			const k = m[3] + m[4];
			const items = popup();
			if (k === "D") cursor = Math.max(0, cursor - 1);
			else if (k === "C") cursor = Math.min(input.length, cursor + 1);
			else if (k === "1;5D") cursor = wordLeft();
			else if (k === "1;5C") cursor = wordRight();
			else if (k === "H" || k === "1~") cursor = 0;
			else if (k === "F" || k === "4~") { cursor = input.length; scroll = 0; }
			else if (k === "3~") input = input.slice(0, cursor) + input.slice(cursor + 1);
			else if (k === "5~") scroll += page();
			else if (k === "6~") scroll = Math.max(0, scroll - page());
			else if (k === "13;2u" || k === "13;3u") insert("\n");
			else if (k === "A") { if (items) popSel = (popSel + items.length - 1) % items.length; else if (!input.includes("\n")) histMove(-1); else cursor = Math.max(0, input.lastIndexOf("\n", cursor - 1)); }
			else if (k === "B") { if (items) popSel = (popSel + 1) % items.length; else if (!input.includes("\n")) histMove(1); else { const n = input.indexOf("\n", cursor); cursor = n < 0 ? input.length : n + 1; } }
		} else if (m[5] !== undefined) insert("\n");
		else {
			const key = m[6];
			if (dialogKey(key)) continue;
			const items = popup();
			if (key === "\x03") {
				if (running) send({ type: "abort" });
				else return quit();
			} else if (key === "\x04") return quit();
			else if (key === "\r") {
				if (items && items[popSel] && !(input.startsWith("/") && input.trim() === items[popSel].name)) applyPopup(items[popSel]);
				else submit();
			} else if (key === "\n") insert("\n");
			else if (key === "\t") { if (items) applyPopup(items[popSel]); }
			else if (key === "\x1b") popDismissed = input;
			else if (key === "\x0f") expandSteps = !expandSteps;
			else if (key === "\x7f") { if (cursor > 0) { input = input.slice(0, cursor - 1) + input.slice(cursor); cursor--; popSel = 0; popDismissed = ""; } }
			else if (key === "\x15") { input = input.slice(cursor); cursor = 0; }
			else if (key === "\x0b") input = input.slice(0, cursor);
			else if (key === "\x17") { const i = wordLeft(); input = input.slice(0, i) + input.slice(cursor); cursor = i; }
			else if (key === "\x01") cursor = 0;
			else if (key === "\x05") cursor = input.length;
			else if (key === "\x10") histMove(-1);
			else if (key === "\x0e") histMove(1);
			else if (key >= " ") { insert(key); popDismissed = ""; }
		}
	}
	drawNow();
});
out.on("resize", () => { previous = []; out.write(`${ESC}2J`); drawNow(); });
child.on("exit", () => quit());
out.write(`${ESC}?1049h${ESC}?1000h${ESC}?1006h${ESC}?2004h${ESC}2J`);
drawNow();

send({ id: "state", type: "get_state" });
send({ id: "cmds", type: "get_commands" });
refreshStats();
refreshGit();
