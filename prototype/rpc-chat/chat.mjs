#!/usr/bin/env node
// Prototype: a chat UI written from scratch on top of `pi --mode rpc` (no pi-tui, no dependencies).
// Differential rendering: only the rows that changed are written; streaming redraws are capped (PROTO_FPS, default 30; 15 while a turn is running),
// key presses redraw at once. Usage: node chat.mjs [pi options, e.g. --model haiku]
import { spawn, execFile } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, watch as fsWatch } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { checkOutcome, failingTests } from "../../pi-ui/src/test-output.ts";
import { cockpitHead, cockpitRows, createFeed, groupSteps, navigate, TAB_COUNT, createStats } from "./cockpit.mjs";
import { readUsage as readUsageFile, forecastLines, resetLabel } from "../../pi-ui/src/usage.ts";

const FPS = Number(process.env.PROTO_FPS) || 30;
// Sessions are persisted by default (pass --no-session to opt out).
const piArgs = ["--mode", "rpc", ...process.argv.slice(2)];
const env = { ...process.env };
delete env.NODE_OPTIONS;
const child = spawn("pi", piArgs, { stdio: ["pipe", "pipe", "pipe"], env, shell: process.platform === "win32" });
let errTail = ""; // last stderr of Pi: shown (and logged) if Pi dies under us, otherwise it would vanish with the alt screen
child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-4000); });

let yolo = env.PI_YOLO === "1"; // mirrors the permission mode of the Pi child (/no-permissions toggles it)
// Animation (PROTO_ANIM=0 turns it off): one 8 fps clock, only while a turn runs; frames are static strings, no per-frame allocation beyond one slice.
const ANIM = process.env.PROTO_ANIM !== "0";
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const tickNow = () => Math.floor(Date.now() / 125);
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
let lastPoll = 0, pollFrom = 0; // while "working", ask Pi every 3 s whether it really is (a lost agent_settled must not leave the bar stuck)
const tokens = { out: 0 };
let input = "", cursor = 0, scroll = 0, frames = 0;
let sessionFile = "", sessionName = "";
// Subscription usage (written by pi-claude-code after each answer); re-read when a turn ends.
// Severity colors/icons for toasts.
const SEV = { err: { c: S.err, i: "✖" }, warn: { c: S.warn, i: "▲" }, info: { c: S.cyan, i: "●" } };
const sevOf = (t) => (/error|errore|failed|fail|denied|rifiutat/i.test(t) ? "err" : /warn|attenz|avviso|nessun|non /i.test(t) ? "warn" : "info");
// One severity scale for every bar and percentage (ctx, 5h, 7g).
const heat = (pct, low = S.dim) => (pct >= 85 ? S.err : pct >= 65 ? S.warn : low);
let usageText = "", usage = {};
const readUsage = () => {
	try {
		// Reset times and burn-rate forecast per window, computed once per read (turn end), never per frame.
		const raw = readUsageFile(), now = Date.now();
		usage = raw ? { h5r: resetLabel(raw.fiveHourResetsAt, now), d7r: resetLabel(raw.sevenDayResetsAt, now), h5f: forecastLines(raw, "five_hour", now), d7f: forecastLines(raw, "seven_day", now) } : {};
		const u = JSON.parse(readFileSync(join(homedir(), ".pi/agent/claude-code-usage.json"), "utf8"));
		const pc = (x) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "");
		const col = (x) => heat(x * 100);
		usage = { ...usage, h5: u.fiveHourUtilization, d7: u.sevenDayUtilization };
		usageText = [["5h", u.fiveHourUtilization], ["7g", u.sevenDayUtilization]].filter(([, x]) => typeof x === "number").map(([l, x]) => `${col(x)}${l} ${pc(x)}${S.dim}`).join(" ");
	} catch { usageText = ""; usage = {}; }
};
let model = "", ctxPct, cost, toast = "", dialog, title = "pi";
const statuses = new Map(), widgets = new Map();
let expandSteps = false, showThinking = false, suggestions = [], queued = 0, sigAt = 0, sigWhat = ""; // sigAt/sigWhat = last Pi signal; queued = messages waiting in Pi's queue (queue_update) (shown in the status bar)
const SUG = "<!--suggerimenti-->";
const git = { branch: "", files: [] };
let commands = [{ name: "resume", description: "riprendi una sessione" }, { name: "model", description: "cambia modello (/model [nome])" }, { name: "name", description: "nome della sessione" }, { name: "now", description: "invia subito la coda: i comandi bash in corso passano in background, altrimenti interrompe (ctrl+enter)" }, { name: "quit", description: "esci" }, { name: "clear", description: "pulisci la vista" }, { name: "new", description: "nuova sessione" }, { name: "compact", description: "compatta il contesto" }, { name: "img", description: "invia un'immagine: /img percorso testo" }];
let projectFiles = [];
const hist = []; let hIdx = 0, draft = "";
let popSel = 0, popDismissed = "";
let imageProto = "?"; // "?" asking, then "kitty" | "sixel" | "none" (detected from the terminal's own replies)

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
// Memoized (bounded): the same rows are measured and cut on every frame while only a few change.
const widthMemo = new Map();
const width_ = (t) => {
	if (t.length < 12) return widthRaw(t);
	let w = widthMemo.get(t);
	if (w === undefined) { if (widthMemo.size > 3000) widthMemo.clear(); w = widthRaw(t); widthMemo.set(t, w); }
	return w;
};
const widthRaw = (t) => { let w = 0; for (const ch of t.replace(STRIP, "")) w += cw(ch.codePointAt(0)); return w; };
const pad = (line, w) => line + " ".repeat(Math.max(0, w - width_(line)));
// Cut a styled line to `w` visible columns (ANSI kept, reset appended when cut).
const cutMemo = new Map();
const cut = (line, w) => {
	if (line.length < 12) return cutRaw(line, w);
	const hit = cutMemo.get(line);
	if (hit && hit[0] === w) return hit[1];
	const res = cutRaw(line, w);
	if (cutMemo.size > 3000) cutMemo.clear();
	cutMemo.set(line, [w, res]);
	return res;
};
const cutRaw = (line, w) => {
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


// --- Images: kitty graphics only (PNG sent once, placed by id). Sixel was dropped: heavy (CPU, bytes on every redraw) and rarely useful.
let cellW = 9, cellH = 18; // pixels per cell, refined by the terminal's reply to CSI 16 t
const images = new Map(); // id -> {b64, mime, w, h, sent}
let imageSeq = 0;
const MARK = /\x1b\[0;9990;(\d+);(\d+);(\d+)m/;
const pngSize = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : undefined);
const jpgSize = (b) => {
	if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
	for (let i = 2; i + 9 < b.length; ) {
		if (b[i] !== 0xff) { i++; continue; }
		const t = b[i + 1];
		if (t >= 0xc0 && t <= 0xcf && t !== 0xc4 && t !== 0xc8 && t !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
		i += 2 + b.readUInt16BE(i + 2);
	}
	return undefined;
};
// Add an image block; returns false when the data is not usable.
const addImage = (data, mime, kind) => {
	const bytes = Buffer.from(data, "base64");
	const size = mime === "image/png" ? pngSize(bytes) : /jpe?g/.test(mime) ? jpgSize(bytes) : undefined;
	const id = ++imageSeq;
	images.set(id, { b64: data, mime, w: size?.[0] ?? 0, h: size?.[1] ?? 0, kb: Math.round(bytes.length / 1024) });
	blocks.push({ kind: "image", img: id, text: "" });
	open = undefined;
};
const imageLines = (block, width) => {
	const img = images.get(block.img);
	const usable = img.w && (imageProto === "kitty" && img.mime === "image/png");
	if (!usable) return [`${S.dim}🖼 ${img.mime} ${img.w ? `${img.w}×${img.h} ` : ""}${img.kb} KB${imageProto === "none" || imageProto === "?" ? " (terminale senza immagini)" : img.mime !== "image/png" ? " (solo PNG)" : ""}${R}`];
	const maxC = Math.max(4, Math.min(width - 6, 56)), maxR = 18; // width - 6 leaves a gap before the side panel
	const scale = Math.min((maxC * cellW) / img.w, (maxR * cellH) / img.h, 1);
	const cols = Math.max(1, Math.ceil((img.w * scale) / cellW)), rows = Math.max(1, Math.ceil((img.h * scale) / cellH));
	return [`\x1b[0;9990;${block.img};${cols};${rows}m`, ...Array(rows - 1).fill("")];
};
// Escape sequences that draw the images whose rows changed; kitty images that left the screen are deleted.
let shownKitty = new Set();
const placeImages = (next, prev) => {
	let post = "";
	const seen = new Set();
	for (let i = 0; i < next.length; i++) {
		const m = MARK.exec(next[i]);
		if (!m) continue;
		const id = Number(m[1]), cols = Number(m[2]), rows = Number(m[3]), img = images.get(id);
		seen.add(id);
		let changed = false;
		for (let r = 0; r < rows && !changed; r++) changed = next[i + r] !== prev[i + r] || (r === 0 && !shownKitty.has(id) && imageProto === "kitty");
		if (!changed) continue;
		post += `${ESC}${i + 1};1H`;
		if (imageProto === "kitty") {
			if (!img.sent) {
				for (let o = 0; o < img.b64.length; o += 4096) post += `\x1b_G${o === 0 ? `a=t,f=100,i=${id},t=d,q=2,` : ""}m=${o + 4096 < img.b64.length ? 1 : 0};${img.b64.slice(o, o + 4096)}\x1b\\`;
				img.sent = true;
			}
			post += `\x1b_Ga=p,i=${id},p=1,c=${cols},r=${rows},C=1,q=2\x1b\\`;
		}
	}
	if (imageProto === "kitty") for (const id of shownKitty) if (!seen.has(id)) post += `\x1b_Ga=d,d=i,i=${id},p=1,q=2\x1b\\`;
	shownKitty = seen;
	return post;
};

// --- Markdown (line based, streaming friendly).
const link = (p, l) => `\x1b]8;;vscode://file${p.startsWith("/") ? "" : `${process.cwd()}/`}${p}${l ? `:${l}` : ""}\x07`;
const inline = (t) =>
	t
		.replace(/(^|[\s(])((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.\w{1,5})(?::(\d+))?(?=[\s),.;:]|$)/g, (_, a, p, l) => `${a}${link(p, l)}${S.cyan}${p}${l ? `:${l}` : ""}${S.text}\x1b]8;;\x07`)
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
			if (fence) { lang = m[1]; const tag = ` ${lang || "code"} `; res.push(`${bg(P.codeBg)}${S.faint}╭${"─".repeat(Math.max(1, width - 1 - tag.length))}${S.dim}${tag}${R}`); }
			else res.push(`${bg(P.codeBg)}${S.faint}╰${"─".repeat(Math.max(0, width - 1))}${R}`);
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
const diffRows = (patch, width) => {
	const rows = [];
	let o = 0, n = 0, dels = 0, adds = 0, more = 0;
	for (const l of patch.split("\n")) {
		const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
		if (h) { o = +h[1]; n = +h[2]; continue; }
		if (/^(---|\+\+\+|diff |index )/.test(l)) continue;
		if (l[0] === "+" && adds++ >= 7) { more++; n++; }
		else if (l[0] === "-" && dels++ >= 7) { more++; o++; }
		else if (l[0] === "+") rows.push(`${bg("#10281d")}${S.ok}${String(n++).padStart(4)} + ${cut(l.slice(1), width - 8).replace(/\t/g, "  ")}${R}`);
		else if (l[0] === "-") rows.push(`${bg("#2a1119")}${S.err}${String(o++).padStart(4)} - ${cut(l.slice(1), width - 8).replace(/\t/g, "  ")}${R}`);
		else { o++; n++; }
	}
	if (more) rows.push(`${S.dim}   … +${more} righe${R}`);
	return rows;
};
// One tool step as a slim card in the toast style: status bar on the left, name, duration at the right edge.
const stepRow = (color, mark, text, right, width) => {
	const rw = width_(right), body = cut(`${color}▎${R}${bg(P.userBg)} ${color}${mark}${R}${bg(P.userBg)} ${S.dim}${text}`, Math.max(8, width - rw - 1));
	return `${bg(P.userBg)}${pad(body, width - rw - 1)}${S.faint}${right}${R}${bg(P.userBg)} ${R}`;
};
const toolLine = (b, width) => {
	const color = b.done === undefined ? S.yel : b.failed ? S.err : S.ok;
	const mark = b.done === undefined ? "⠿" : b.failed ? "✗" : "✓";
	const time = b.done === undefined ? "…" : b.ms != null ? (b.ms >= 1000 ? `${(b.ms / 1000).toFixed(1)}s` : `${b.ms}ms`) : "";
	return stepRow(color, mark, toolLabel(b), time, width) + (b.patch ? "\n" + diffRows(b.patch, width).join("\n") : "");
};
// Markdown is line based, so everything up to the last blank line outside a code fence renders the same whatever follows:
// that prefix is rendered once (kept on the block) and only the open tail is redone on each streaming frame.
const GUT = `${S.faint}▍${R} `;
const gutter = (lines) => lines.map((l) => GUT + l);
const streamMarkdown = (block, text, width_in) => {
	const width = width_in - 2, md = (t) => gutter(markdown(t, width));
	const cut_ = text.lastIndexOf("\n\n");
	if (cut_ <= 0) return md(text);
	const head = text.slice(0, cut_);
	if ((head.match(/^```/gm) || []).length % 2) return md(text); // blank line inside a code fence: render whole
	const memo = block.md;
	if (!memo || memo.width !== width || !head.startsWith(memo.text)) block.md = { width, text: "", lines: [] };
	const m = block.md;
	if (m.text.length < head.length) { m.lines = m.lines.concat(md(m.text ? head.slice(m.text.length + 1) : head)); m.text = head; }
	return m.lines.concat(md(text.slice(head.length + 1)));
};
const blockLines = (block, width) => {
	const done = block !== open && (block.kind !== "tool" || block.done !== undefined);
	const hit = cache.get(block);
	if (done && hit && hit.width === width && hit.len === block.text.length && hit.sh === showThinking) return hit.lines;
	let lines;
	if (block.kind === "assistant") lines = streamMarkdown(block, block.text.includes(SUG) ? block.text.slice(0, block.text.indexOf(SUG)).trimEnd() : block.text, width);
	else if (block.kind === "user") {
		const inner = hardWrap(block.text, width - 3);
		lines = inner.map((l) => `${bg(P.userBg)}${S.mag}▌${S.text} ${pad(l, width - 2)}${R}`);
	} else if (block.kind === "thinking") {
		const all = wrap(block.text.trim(), width - 3);
		const words = block.text.split(/\s+/).filter(Boolean).length;
		const shown = showThinking ? all : done ? [] : all.slice(-4);
		const head = done && !showThinking ? `◇ thought · ${words} words (ctrl+t)` : done ? `◇ thought · ${words} words` : `◇ thinking · ${words} words${all.length > 4 ? ` (+${all.length - 4} above)` : ""}`;
		lines = [`${S.dim}${S.i}${head}${R}`, ...shown.map((l) => `${S.faint}┊ ${S.dim}${S.i}${l}${R}`)];
	} else if (block.kind === "image") lines = imageLines(block, width);
	else lines = [toolLine(block, width)];
	lines.push("");
	if (done && block.kind !== "image") cache.set(block, { width, len: block.text.length, sh: showThinking, lines });
	return lines;
};

// Messages sent while Pi works wait at the bottom of the chat, dimmed, with the send-now key, until Pi hands them to
// the model (message_start of a user message carrying their text): then they take their place in the conversation.
const queuedMsgs = [];
const queue = (text, sent) => { queuedMsgs.push({ kind: "user", text, sent: sent ?? text }); };
const deliver = (t) => {
	let moved = false;
	for (let i = 0; i < queuedMsgs.length; ) {
		if (t === queuedMsgs[i].sent || t.includes(queuedMsgs[i].sent)) { blocks.push({ kind: "user", text: queuedMsgs.splice(i, 1)[0].text }); moved = true; }
		else i++;
	}
	if (moved) open = undefined;
};
const pendingLines = (width) => {
	if (!queuedMsgs.length) return [];
	const body = [""];
	for (const p of queuedMsgs) for (const l of hardWrap(p.text, width - 3)) body.push(`${S.faint}▌ ${S.dim}${pad(l, width - 2)}${R}`);
	body.push(`${S.dim}  ↳ in coda · ${S.warn}alt+${NOW_ALT}${S.dim} invia ora${R}`, "");
	return body;
};

// Consecutive tool blocks collapse into one summary line once they are done (ctrl+o expands).
const bodyLines = (width) => {
	const body = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block.kind === "user" && body.length && blocks[i - 1]?.kind !== "user") body.push(""); // air between turns
		if (block.kind !== "tool") { body.push(...blockLines(block, width)); continue; }
		let j = i;
		while (j + 1 < blocks.length && blocks[j + 1].kind === "tool") j++;
		const group = blocks.slice(i, j + 1);
		const live = group.some((b) => b.done === undefined);
		if (expandSteps || group.length <= 2 || live) {
			const shown = !expandSteps && group.length > 4 ? group.slice(-3) : group;
			if (shown.length < group.length) body.push(stepRow(S.dim, "⠿", `${group.length - shown.length} earlier steps`, "ctrl+o", width));
			for (const b of shown) body.push(...toolLine(b, width).split("\n"));
		} else {
			const counts = new Map();
			for (const b of group) counts.set(toolName(b), (counts.get(toolName(b)) ?? 0) + 1);
			const failed = group.filter((b) => b.failed).length;
			const ms = group.reduce((a, b) => a + (b.ms ?? 0), 0);
			body.push(stepRow(failed ? S.err : S.ok, failed ? "✗" : "✓", `${group.length} steps · ${[...counts].map(([n, c]) => `${n}×${c}`).join(" ")}${failed ? ` · ${failed} failed` : ""}`, `${ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms"} ctrl+o`, width));
		}
		body.push("");
		i = j;
	}
	body.push(...pendingLines(width));
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
// Images waiting for the next prompt (pasted file paths, alt+v from the clipboard): {data, mime, name}.
const attached = [];
const IMG_RE = /\.(png|jpe?g)$/i;
const attachFile = (raw) => {
	const path = raw.trim().replace(/^['"]|['"]$/g, "").replace(/^file:\/\//, "").replace(/\\ /g, " ");
	if (!IMG_RE.test(path) || path.includes("\n")) return false;
	try { attached.push({ data: readFileSync(path).toString("base64"), mime: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png", name: path.split(/[\\/]/).pop() }); return true; } catch { return false; }
};
// Clipboard image: wl-paste (Wayland), xclip (X11), PowerShell (WSL, Windows).
const pasteClipboardImage = () => {
	const tries = process.platform === "win32" ? [["powershell", ["-NoProfile", "-Command", CLIP_PS]]]
		: [["wl-paste", ["-t", "image/png"]], ["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]], ["powershell.exe", ["-NoProfile", "-Command", CLIP_PS]]];
	const next = (i) => {
		if (i >= tries.length) { toast = "nessuna immagine negli appunti"; schedule(); return; }
		const [cmd, args] = tries[i];
		const isPs = cmd.startsWith("powershell");
		execFile(cmd, args, { maxBuffer: 64 << 20, encoding: isPs ? "utf8" : "buffer", timeout: 8000 }, (err, stdout) => {
			const data = !err && stdout && stdout.length > 100 ? (isPs ? String(stdout).trim() : Buffer.from(stdout).toString("base64")) : "";
			if (data && data.length > 100) { attached.push({ data, mime: "image/png", name: "appunti.png" }); schedule(); } else next(i + 1);
		});
	};
	next(0);
};
const CLIP_PS = "Add-Type -AssemblyName System.Windows.Forms; $i=[System.Windows.Forms.Clipboard]::GetImage(); if($i){$m=New-Object System.IO.MemoryStream; $i.Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray())}";
let panelOff = false; // alt+s hides / shows the panel (on narrow terminals it opens as a block above the status bar)
let tests; // last test run seen in a bash result: {pass, fail, failing[]}
const TEST_CMD = /\b(node\s+--test|npm\s+(run\s+)?test|pytest|vitest|jest|cargo\s+test|go\s+test)\b/;
const testResult = (cmd, text, isError) => {
	if (!TEST_CMD.test(String(cmd ?? ""))) return;
	const o = checkOutcome(text, isError, true);
	tests = { pass: o.pass, fail: o.fail, failed: o.failed, failing: o.failed ? failingTests(text).slice(0, 5) : [] };
	sideVer++;
};
let plan = []; // todo tasks {subject, status}
let intentInfo; // active intent {title, done, total}
let sideVer = 0, sideSeen = -1, sideW = 0, sideCache = [];
const sideLines = (w) => {
	const L = [];
	const head = (t) => L.push(`${S.b}${S.dim}${t}${R} ${S.faint}${"─".repeat(Math.max(0, w - 1 - width_(t)))}${R}`);
	const bar = (label, pct) => { const n = Math.max(4, w - 10), f = Math.round((Math.max(0, Math.min(100, pct)) / 100) * n); return `${S.dim}${label.padEnd(3)}${R} ${heat(pct, S.ok)}${"▰".repeat(f)}${S.faint}${"▱".repeat(n - f)}${R} ${S.dim}${String(Math.round(pct)).padStart(3)}%${R}`; };
	const kv = (k, v) => `${S.dim}${k}${R}${" ".repeat(Math.max(1, w - k.length - width_(v)))}${S.text}${v}${R}`;
	// Auto mode first: a run going on its own must be visible at a glance (lines from extensions/auto/loop.ts panelLines).
	const auto = widgets.get("auto");
	if (auto?.length) {
		const stopped = auto[0].startsWith("■"), ok = / · completato$/.test(auto[0]);
		head(stopped ? "AUTO" : `${S.mag}AUTO ● attivo`);
		auto.forEach((l, i) => L.push(...wrap(i === 0 ? `${S.b}${stopped ? (ok ? S.ok : S.warn) : S.mag}${l}${R}` : l.startsWith("⚠") ? `${S.warn}${l}${R}` : /^[▰▱]+$/.test(l) ? `${S.ok}${l.replace(/▱/, `${S.faint}▱`)}${R}` : l.startsWith("→") ? `${S.text}${l}${R}` : `${S.dim}${l}${R}`, w)));
		L.push("");
	}
	const intent = statuses.get("intent");
	if (intent) { head("INTENT"); L.push(...wrap(`${S.text}${intent}${R}`, w)); if (intentInfo) L.push(`${S.dim}${intentInfo.done}/${intentInfo.total} outcome${R}`); L.push(""); }
	if (statuses.get("goal")) { head("GOAL"); L.push(...wrap(`${S.text}${statuses.get("goal")}${R}`, w)); L.push(""); }
	if (plan.length) {
		head(`PIANO ${plan.filter((t) => t.status === "completed").length}/${plan.length}`);
		for (const t of plan.slice(0, 10)) L.push(cut(`${t.status === "completed" ? `${S.ok}✔` : t.status === "in_progress" ? `${S.mag}◐` : `${S.faint}○`}${R} ${t.status === "completed" ? S.dim : S.text}${t.subject}${R}`, w));
		if (plan.length > 10) L.push(`${S.dim}+${plan.length - 10} altri${R}`);
		L.push("");
	}
	if (tests) {
		head("TEST");
		L.push(`${tests.failed ? S.err : S.ok}${tests.failed ? "✗" : "✓"}${R} ${S.dim}${tests.pass ?? "?"} ok · ${tests.fail ?? (tests.failed ? "?" : 0)} falliti${R}`);
		for (const f of tests.failing) L.push(...wrap(`${S.err}· ${R}${S.text}${f}${R}`, w));
		L.push("");
	}
	head(`GIT ${git.branch ? `${S.cyan}${git.branch}` : ""}`);
	if (!git.files.length) L.push(`${S.dim}pulito${R}`);
	for (const f of git.files.slice(0, 8)) L.push(`${f.st.includes("?") ? S.warn : S.ok}${f.st.padEnd(2)}${R} ${S.dim}${cut(f.p, w - 4)}${R}`);
	if (git.files.length > 8) L.push(`${S.dim}+${git.files.length - 8} altri${R}`);
	L.push("");
	head("CONTEXT");
	L.push(bar("ctx", ctxPct ?? 0));
	if (cost != null) L.push(kv("costo", `$${cost.toFixed(2)}`));
	L.push(kv("immagini", imageProto === "?" ? "…" : imageProto));
	const arc = statuses.get("archivio"), mem = statuses.get("memory");
	if (arc) L.push(kv("archivio", arc));
	if (mem) { const parts = mem.split(" · "); L.push(kv("memoria", parts[0])); for (const part of parts.slice(1)) L.push(...wrap(`${S.dim}${part}${R}`, w)); }
	if (usage.h5 != null || usage.d7 != null) {
		L.push(""); head("USO");
		const rows = (reset, fc) => { for (const r of [...(reset ? [{ role: "dim", label: "Reset", value: reset }] : []), ...(fc ?? [])]) L.push(kv(`  ${r.label}`, r.role === "err" ? `${S.err}${r.value}` : r.role === "warn" ? `${S.warn}${r.value}` : r.role === "ok" ? `${S.ok}${r.value}` : r.value)); };
		if (usage.h5 != null) { L.push(bar("5h", usage.h5 * 100)); rows(usage.h5r, usage.h5f); }
		if (usage.d7 != null) { L.push(bar("7g", usage.d7 * 100)); rows(usage.d7r, usage.d7f); }
	}
	const wk = [...widgets].filter(([k]) => k !== "btw" && k !== "auto" && k !== "bg-tasks");
	if (wk.length) {
		L.push(""); head("ATTIVITÀ");
		let first = true;
		for (const [, lines] of wk) { if (!first) L.push(""); first = false; for (const l of lines) for (const x of wrapAnsi(`${S.text}${l}${R}`, w, 2)) L.push(x); }
	}
	const others = [...statuses].filter(([k]) => k !== "intent" && k !== "goal" && k !== "memory" && k !== "archivio" && k !== "claude-code" && !(k === "auto" && auto?.length));
	if (others.length) { L.push(""); head("ESTENSIONI"); for (const [k, v] of others) L.push(...wrap(`${S.dim}${new RegExp(k, "i").test(v) ? v : `${k} ${v}`}${R}`, w)); }
	return L;
};

// --- Frame.
// Loading page: shown until Pi answers its first command (extensions, memory and the Claude bridge load before that).
let booting = true;
const bootAt = Date.now();
const bootFile = join(homedir(), ".pi", "agent", "proto-boot.json");
// Expected duration = the previous start (the bar is an estimate from it, capped at 95%); the label is what Pi really did last.
const bootExpect = (() => { try { return Math.max(3000, Number(JSON.parse(readFileSync(bootFile, "utf8")).ms) || 0) || 12000; } catch { return 12000; } })();
let bootStage = "avvio del processo Pi", bootSeen = 0;
const bootNote = (what) => { bootSeen++; bootStage = what; };
const bootVersion = (() => { try { return JSON.parse(readFileSync(join(dirname(process.argv[1] ?? "."), "..", "..", "package.json"), "utf8")).version; } catch { return ""; } })();
const bootFrame = () => {
	const W = out.columns || 80, H = out.rows || 24, secs = Math.floor((Date.now() - bootAt) / 1000), frac = Math.min(0.95, (Date.now() - bootAt) / bootExpect);
	const mid = (t) => `${" ".repeat(Math.max(0, Math.floor((W - width_(t)) / 2)))}${t}`;
	const body = [
		`${S.b}${S.cyan}pi${R}${S.dim} · claude code${bootVersion ? ` ${bootVersion}` : ""}${R}`,
		"",
		`${S.mag}${ANIM ? SPIN[tickNow() % SPIN.length] : "●"}${R} ${S.text}avvio di Pi${R}${S.dim} · ${secs}s${R}`,
		`${S.mag}${"▰".repeat(Math.round(frac * 30))}${S.faint}${"▱".repeat(30 - Math.round(frac * 30))}${S.dim} ${Math.round(frac * 100)}%${R}`,
		`${S.dim}${cut(bootStage, Math.max(10, W - 8))}${secs >= bootExpect / 1000 * 1.5 ? " · più lento del solito" : ""}${R}`,
		"",
		`${S.faint}ctrl+c esce${R}`,
	];
	const top = Math.max(0, Math.floor((H - body.length) / 2) - 1);
	const next = Array.from({ length: H }, (_, i) => (i >= top && i < top + body.length ? mid(body[i - top]) : ""));
	let buf = "";
	for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) buf += `${ESC}${i + 1};1H${next[i]}${ESC}K`;
	previous = next;
	buf += `${ESC}?25l`;
	if (buf) out.write(buf);
};
// --- Questionnaire (ask_user_question). Without a real terminal the extension sends one select/input dialog per question;
// we draw all the questions in one card (tabs, checkboxes, preview, free text, review page) and answer those dialogs ourselves.
let qz;
const qzMk = (qs) => ({ qs, tab: 0, a: qs.map(() => ({ sel: 0, on: new Set(), text: "", done: false })), ready: false, cancelled: false, held: undefined, resp: [] });
const qzName = (q, i) => q.header || `Domanda ${i + 1}`;
const qzSummary = (q, a) => !a.done ? "—" : q.multiSelect ? (a.text.trim() || [...a.on].sort((x, y) => x - y).map((i) => q.options[i].label).join(", ") || "(nessuna)") : a.sel < q.options.length ? q.options[a.sel].label : a.text.trim();
// Answers in the order the extension asks its dialogs: single option, "Type something" (select + input), or multi (one input "1,3").
const qzResp = (z) => z.qs.flatMap((q, i) => {
	const a = z.a[i];
	if (q.multiSelect) return [{ kind: "text", v: a.text.trim() || [...a.on].sort((x, y) => x - y).map((k) => k + 1).join(",") }];
	return a.sel < q.options.length ? [{ kind: "opt", i: a.sel }] : [{ kind: "other" }, { kind: "text", v: a.text.trim() }];
});
const qzReply = (r) => {
	if (qz.cancelled) { send({ type: "extension_ui_response", id: r.id, cancelled: true }); return; }
	const e = qz.resp.shift();
	const v = e?.kind === "opt" && r.method === "select" ? (r.options ?? []).find((o) => String(o).startsWith(`${e.i + 1}.`))
		: e?.kind === "other" && r.method === "select" ? (r.options ?? []).at(-1)
		: e?.kind === "text" && r.method !== "select" ? e.v : undefined;
	if (v === undefined) { qz = undefined; onRecord(r); return; } // unexpected sequence: show the dialog the plain way
	send({ type: "extension_ui_response", id: r.id, value: v });
};
// True when the dialog request was taken over (held until the card is finished, or answered from it).
const qzIntercept = (r) => {
	if (!qz || !["select", "input", "editor"].includes(r.method)) return false;
	if (!qz.ready && !qz.cancelled) { qz.held = r; return true; }
	qzReply(r); return true;
};
const qzKey = (z, key, csi) => {
	const n = z.qs.length, review = n > 1, last = review ? n : n - 1;
	const finish = () => { z.resp = qzResp(z); z.ready = true; dialog = undefined; if (z.held) { const h = z.held; z.held = undefined; qzReply(h); } };
	const cancel = () => { z.cancelled = true; dialog = undefined; if (z.held) { const h = z.held; z.held = undefined; qzReply(h); } };
	if (key === "\x1b" && !csi) return cancel();
	if (csi === "C") { z.tab = Math.min(last, z.tab + 1); return; }
	if (csi === "D") { z.tab = Math.max(0, z.tab - 1); return; }
	if (review && z.tab === n) {
		if (key === "\r" || key === "\n") { const miss = z.a.findIndex((a) => !a.done); if (miss >= 0) z.tab = miss; else finish(); }
		return;
	}
	const q = z.qs[z.tab], a = z.a[z.tab], no = q.options.length, onOther = a.sel === no;
	const advance = () => { a.done = true; if (z.tab < last) z.tab++; else finish(); };
	if (csi === "A") a.sel = Math.max(0, a.sel - 1);
	else if (csi === "B") a.sel = Math.min(no, a.sel + 1);
	else if (key === "\r" || key === "\n") { if (!q.multiSelect && onOther && !a.text.trim()) return; advance(); }
	else if (onOther && key === "\x7f") a.text = a.text.slice(0, -1);
	else if (onOther && key && key >= " " && !csi) a.text += key;
	else if (!csi && key >= "1" && key <= "9" && +key <= no) { if (q.multiSelect) toggle(a, +key - 1); else { a.sel = +key - 1; advance(); } }
	else if (!csi && key === " " && q.multiSelect) toggle(a, a.sel);
};
const toggle = (a, i) => { if (a.on.has(i)) a.on.delete(i); else a.on.add(i); };
const quizLines = (z, bar, iw, leftW, H) => {
	const L = [], n = z.qs.length;
	const hint = (...kv) => `${bar}${kv.map(([k, v]) => `${S.text}${k}${S.dim} ${v}${R}`).join(`${S.faint}  ·  `)}`;
	const tabs = z.qs.map((q, i) => { const on = i === z.tab, mark = z.a[i].done ? "●" : "○", lab = cut(qzName(q, i), 14); return on ? `${S.cyan}${S.b}${mark} ${lab}${R}` : `${z.a[i].done ? S.ok : S.dim}${mark} ${lab}${R}`; });
	if (n > 1) tabs.push(z.tab === n ? `${S.cyan}${S.b}✓ Rivedi${R}` : `${S.dim}✓ Rivedi${R}`);
	L.push(cut(`${bar}${S.mag}${S.b}DOMANDE${R}  ${tabs.join("  ")}`, leftW));
	L.push(bar.trimEnd());
	if (n > 1 && z.tab === n) {
		z.qs.forEach((q, i) => { const a = z.a[i]; L.push(cut(`${bar}${a.done ? `${S.ok}✓` : `${S.err}✖`} ${S.dim}${qzName(q, i)}${R}  ${S.text}${qzSummary(q, a)}${R}`, leftW)); });
		L.push(bar.trimEnd());
		L.push(hint(["⏎", "invia"], ["←", "correggi"], ["esc", "annulla"]));
		return L;
	}
	const q = z.qs[z.tab], a = z.a[z.tab], no = q.options.length;
	for (const w of wrap(q.question, iw)) L.push(`${bar}${S.b}${S.text}${w}${R}`);
	L.push(bar.trimEnd());
	q.options.forEach((o, i) => {
		const cur = a.sel === i, box = q.multiSelect ? (a.on.has(i) ? "☑" : "☐") : (a.done && a.sel === i ? "◉" : "○");
		L.push(cur ? `${bar}${bg(P.userBg)}${S.cyan}▸ ${S.dim}${i < 9 ? i + 1 : " "} ${S.cyan}${box} ${S.b}${S.text}${pad(cut(o.label, iw - 8), iw - 7)}${R}` : `${bar}${S.faint}  ${i < 9 ? i + 1 : " "} ${S.dim}${box} ${S.text}${cut(o.label, iw - 8)}${R}`);
		if (cur && o.description) for (const w of wrap(o.description, iw - 8).slice(0, 2)) L.push(`${bar}${S.dim}        ${w}${R}`);
	});
	const cur = a.sel === no;
	L.push(`${bar}${cur ? `${bg(P.userBg)}${S.cyan}▸ ${S.mag}✎ ${S.text}${pad(a.text ? `${cut(a.text, iw - 8)}${S.mag}▌` : `${S.mag}▌${S.faint}scrivi la tua risposta`, iw - 4)}` : `${S.faint}    ${S.dim}✎ ${a.text ? S.text : S.faint}${cut(a.text || "scrivi la tua risposta…", iw - 8)}`}${R}`);
	const pv = !cur && q.options[a.sel]?.preview;
	if (pv) {
		L.push(bar.trimEnd());
		const rows = pv.split("\n").flatMap((l) => wrap(l, iw - 4));
		for (const l of rows.slice(0, Math.max(3, Math.min(8, H - 24)))) L.push(`${bar}${S.faint}┆ ${S.dim}${l}${R}`);
		if (rows.length > Math.max(3, Math.min(8, H - 24))) L.push(`${bar}${S.faint}┆ …${R}`);
	}
	L.push(bar.trimEnd());
	L.push(q.multiSelect ? hint(["↑↓", "muovi"], ["spazio", "spunta"], ["⏎", "avanti"], ["←→", "domanda"], ["esc", "annulla"]) : hint(["↑↓", "scegli"], ["1-9", "diretto"], ["⏎", "conferma"], ["←→", "domanda"], ["esc", "annulla"]));
	return L;
};
let previous = [], toastText = "", toastSeen = "", toastT0 = 0, toastOut = 0;
// --- Cockpit of /auto (alt+a, or /auto alone): full-screen view of the run, read from the state file and the diary on disk.
// Closed: no cost. Open: one 1 s tick only while the run is active (the "stalled for Ns" counter), plus fs.watch on the run directory.
let cockpit; // {feed, ui: {sel, top, seen, note}, chat: {msgs, typing, busy}, tick, watch}
const cockpitFrame = () => {
	const W = out.columns || 80, H = out.rows || 24;
	const c = cockpit, st = c.feed.state;
	if (!st) return;
	const next = cockpitRows({ state: st, events: c.feed.events, now: Date.now(), W, H, usage: typeof usage.h5 === "number" ? usage.h5 : undefined, ui: c.ui, chat: c.chat });
	let buf = "";
	for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) buf += `${ESC}${i + 1};1H${next[i]}${ESC}K`;
	for (let i = next.length; i < previous.length; i++) buf += `${ESC}${i + 1};1H${ESC}K`;
	previous = next;
	if (buf) out.write(`${ESC}?25l${buf}`);
};
const cockpitHeadOnly = () => {
	const c = cockpit, st = c.feed.state;
	if (!st || !previous.length) return;
	const [row] = cockpitHead({ state: st, events: c.feed.events, now: Date.now(), W: out.columns || 80, usage: typeof usage.h5 === "number" ? usage.h5 : undefined, ui: c.ui });
	if (row !== previous[0]) { previous[0] = row; out.write(`${ESC}?25l${ESC}1;1H${row}${ESC}K`); }
};
const cockpitOpen = () => {
	const file = statuses.get("auto-run");
	if (!file) { toast = "nessuna corsa /auto in questa sessione (avviala con /auto <goal>)"; schedule(); return; }
	const feed = createFeed(file);
	feed.refresh();
	if (!feed.state) { toast = feed.problem === "illeggibile" ? "stato della corsa illeggibile: riprova tra poco (/auto status)" : "nessuna corsa /auto in questa sessione (avviala con /auto <goal>)"; schedule(); return; }
	cockpit = { feed, ui: { sel: -1, top: 0, seen: 0, note: null }, chat: { msgs: [], typing: null, busy: false, open: false }, tick: undefined, watch: undefined, stats: createStats(Date.now()) };
	try { cockpit.watch = fsWatch(dirname(file), { persistent: false }, () => { if (cockpit?.feed.refresh()) schedule(); }); cockpit.watch.on("error", () => {}); } catch {}
	cockpit.tick = setInterval(() => {
		const changed = cockpit.feed.refresh();
		if (cockpit.feed.state.stop) clearInterval(cockpit.tick); // a finished run needs no clock
		if (changed) schedule();
		else if (!cockpit.feed.state.stop) cockpitHeadOnly(); // nothing else changed: only the "stalled for Ns" header moves
	}, 1000);
	cockpit.tick.unref();
	previous = []; out.write(`${ESC}2J`); drawNow();
};
const cockpitClose = () => {
	if (!cockpit) return;
	try { appendFileSync(cockpit.feed.diaryPath.replace(/\.eventi\.jsonl$/, ".cockpit-stats.jsonl"), `${JSON.stringify(cockpit.stats.summary(Date.now()))}\n`); } catch {}
	clearInterval(cockpit.tick); cockpit.watch?.close(); cockpit = undefined;
	previous = []; shownKitty = new Set(); out.write(`${ESC}?25h${ESC}2J`); sideVer++; drawNow();
};
// Guidance goes to the supervisor as /auto subcommands: the extension owns the state and logs every command.
const cockpitKey = (key, csi) => {
	const c = cockpit;
	if (!c) return false;
	const groups = groupSteps(c.feed.events).length;
	const ui = c.ui, chat = c.chat;
	if (chat.typing !== null) {
		if (csi) return true;
		if (key === "\x1b") { if (!chat.typing) chat.open = false; chat.typing = null; }
		else if (key === "\r" || key === "\n") {
			const t = chat.typing.trim(); chat.typing = ""; // stays in chat: the conversation goes on
			if (t) { chat.msgs.push({ role: "user", text: t }); chat.busy = true; send({ type: "prompt", message: t, ...(running ? { streamingBehavior: "followUp" } : {}) }); }
		} else if (key === "\x7f") chat.typing = chat.typing.slice(0, -1);
		else if (key >= " ") chat.typing += key;
		return true;
	}
	if (ui.note !== null) {
		if (csi) return true;
		if (key === "\x1b") ui.note = null;
		else if (key === "\r" || key === "\n") { const t = ui.note.trim(); ui.note = null; if (t) { send({ type: "prompt", message: `/auto nota ${t}` }); toast = "nota in coda per il prossimo passo"; } }
		else if (key === "\x7f") ui.note = ui.note.slice(0, -1);
		else if (key >= " ") ui.note += key;
		return true;
	}
	c.stats.key(key === "c" ? "chat" : key === ":" ? "note" : "k", Date.now());
	const live = ui.sel < 0;
	if (csi === "D") navigate(ui, groups, "left");
	else if (csi === "C") navigate(ui, groups, "right");
	else if (csi === "F" || csi === "4~") navigate(ui, groups, "end");
	else if (csi === "A") ui.top = Math.max(0, ui.top - 1);
	else if (csi === "B") ui.top += 1;
	else if (csi === "5~") ui.top = Math.max(0, ui.top - 10);
	else if (csi === "6~") ui.top += 10;
	else if (csi) return true;
	else if (key === "\x1b") { if (navigate(ui, groups, "esc") === "close") cockpitClose(); }
	else if (key === "q") return cockpitClose(), true;
	else if (key === "p" && !c.feed.state.stop) send({ type: "prompt", message: c.feed.state.paused ? "/auto riprendi" : "/auto pausa" });
	else if (key === "s" && !c.feed.state.stop) send({ type: "prompt", message: "/auto stop" });
	else if (key === ":" && !c.feed.state.stop) ui.note = "";
	else if (key === "c") { chat.typing = ""; chat.open = true; }
	else if (key >= "1" && key <= String(TAB_COUNT)) { ui.tab = Number(key) - 1; ui.top = 0; c.stats.tab(ui.tab, Date.now()); }
	return true;
};

const frame = () => {
	if (booting) return bootFrame();
	if (cockpit) return cockpitFrame();
	frames++;
	const W = out.columns || 80, H = out.rows || 24;
	const side = panelOff ? 0 : W >= 140 ? 36 : W >= 120 ? 34 : W >= 100 ? 28 : 0; // narrower on medium terminals, hidden below 100 columns
	const leftW = side ? W - side - 3 : W;

	// Bottom pieces first: their height decides the chat height.
	const extra = [];
	if (dialog) {
		// Card: accent bar on the left, title, dimmed message, options with the selected row highlighted, key hints.
		const bar = `${S.mag}▍${R} `, iw = leftW - 2;
		const hint = (...kv) => `${bar}${kv.map(([k, v]) => `${S.text}${k}${S.dim} ${v}${R}`).join(`${S.faint}  ·  `)}`;
		const head = `${dialog.title ?? ""}${dialog.message ? `\n${dialog.message}` : ""}`.split("\n");
		if (dialog.method === "pager") {
			for (const l of head) if (l) extra.push(`${bar}${S.b}${S.mag}${cut(l, iw)}${R}`);
			const page = Math.max(3, H - 10);
			for (const l of dialog.lines.slice(dialog.top, dialog.top + page)) extra.push(cut(`${S.text}${l}${R}`, leftW));
			extra.push(hint(["↑↓ PgUp PgDn", "scorri"], ["q", "chiudi"], [`${dialog.top + 1}-${Math.min(dialog.lines.length, dialog.top + page)}/${dialog.lines.length}`, ""]));
		} else if (dialog.method === "quiz") {
			extra.push(...quizLines(dialog.z, bar, iw, leftW, H));
		} else {
			extra.push(`${bar}${S.b}${S.text}${cut(head[0], iw)}${R}`);
			for (const l of head.slice(1)) for (const w of wrap(l, iw)) extra.push(`${bar}${S.dim}${w}${R}`);
			extra.push(bar.trimEnd());
			if (dialog.method === "sessions") {
				const hits = sessionHits(dialog);
				dialog.sel = Math.max(0, Math.min(dialog.sel, hits.length - 1));
				extra.push(`${bar}${bg(P.userBg)}${S.mag}› ${S.text}${pad(`${dialog.query || `${S.faint}scrivi per cercare`}${S.mag}▌`, iw - 2)}${R}`);
				extra.push(bar.trimEnd());
				const room = Math.max(2, Math.floor((H - 16) / 3)), n = hits.length;
				const from = Math.max(0, Math.min(dialog.sel - Math.floor(room / 2), n - room));
				if (!n) extra.push(`${bar}${S.dim}nessuna sessione corrisponde${R}`);
				if (from > 0) extra.push(`${bar}${S.faint}↑ ${from} sopra${R}`);
				hits.slice(from, from + room).forEach((x, k) => {
					const on = from + k === dialog.sel, mark = on ? `${S.cyan}▸ ` : "  ";
					const back = on ? bg(P.userBg) : "";
					extra.push(`${bar}${back}${mark}${on ? S.b : ""}${S.text}${pad(cut(x.title, iw - 3), iw - 2)}${R}`);
					extra.push(`${bar}${back}  ${S.dim}${pad(cut(x.sub, iw - 3), iw - 2)}${R}`);
					extra.push(`${bar}${back}  ${S.faint}${pad(x.last && x.last !== x.title ? cut(`ultima: ${x.last}`, iw - 3) : "", iw - 2)}${R}`);
				});
				if (from + room < n) extra.push(`${bar}${S.faint}↓ ${n - from - room} sotto${R}`);
				extra.push(bar.trimEnd());
				extra.push(hint(["↑↓ PgUp PgDn", "scegli"], ["⏎", "riprendi"], ["esc", dialog.query ? "pulisci" : "annulla"], [`${n ? dialog.sel + 1 : 0}/${n}`, ""]));
			} else if (dialog.method === "select") {
				const room = Math.max(3, H - 14), n = dialog.options.length;
				const from = Math.max(0, Math.min(dialog.sel - Math.floor(room / 2), n - room));
				if (from > 0) extra.push(`${bar}${S.faint}↑ ${from} sopra${R}`);
				let note = "";
				dialog.options.slice(from, from + room).forEach((o, k) => {
					const i = from + k, [lab, ...desc] = String(o).split(/\s+[—–]\s+|\n/);
					const num = i < 9 ? `${i + 1}` : " ";
					if (i === dialog.sel) { extra.push(`${bar}${bg(P.userBg)}${S.cyan}▸ ${S.dim}${num} ${S.b}${S.text}${pad(cut(lab, iw - 5), iw - 4)}${R}`); note = desc.join(" "); }
					else extra.push(`${bar}${S.faint}  ${num} ${S.text}${cut(lab, iw - 5)}${R}`);
					if (i === dialog.sel && note) for (const w of wrap(note, iw - 6).slice(0, 2)) extra.push(`${bar}${S.dim}      ${w}${R}`);
				});
				if (from + room < n) extra.push(`${bar}${S.faint}↓ ${n - from - room} sotto${R}`);
				extra.push(bar.trimEnd());
				extra.push(hint(["↑↓", "scegli"], ["1-9", "diretto"], ["⏎", "conferma"], ["esc", "annulla"]));
			} else if (dialog.method === "confirm") {
				extra.push(`${bar}${S.ok}y${S.text} Sì${R}   ${S.err}n${S.text} No${R}`);
				extra.push(bar.trimEnd());
				extra.push(hint(["⏎", "sì"], ["esc", "annulla"]));
			} else {
				extra.push(`${bar}${bg(P.userBg)}${S.mag}› ${S.text}${pad(`${dialog.text}${S.mag}▌`, iw - 2)}${R}`);
				extra.push(bar.trimEnd());
				extra.push(hint(["⏎", "conferma"], ["esc", "annulla"]));
			}
		}
	}
	const items = popup();
	if (items) {
		popSel = Math.min(popSel, items.length - 1);
		items.forEach((it, i) => {
			const text = `${it.name}${it.desc ? `  ${S.dim}${it.desc}` : ""}`;
			extra.push(i === popSel ? `${bg(P.userBg)}${S.cyan}▸ ${pad(cut(text, leftW - 2), leftW - 2)}${R}` : cut(`  ${S.text}${text}`, leftW) + R);
		});
	}
	if (!input && suggestions.length && !dialog) {
		// Cards side by side (saves rows): equal width, number chip, text wrapped on up to 3 rows with a closing "…"; the
		// background fills the whole cell. Static strings, drawn only while the prompt is empty.
		const n = Math.min(3, suggestions.length), total = leftW - (n - 1), min = Math.min(16, Math.floor(total / n));
		// Widths follow the text length (long ones get more room), the row always spans the whole width.
		const lens = suggestions.slice(0, n).map((x) => Math.max(x.length, 8)), sum = lens.reduce((a, b) => a + b, 0);
		const widths = lens.map((l) => Math.max(min, Math.floor((total * l) / sum)));
		for (let k = 0; widths.reduce((a, b) => a + b, 0) !== total; k++) widths[k % n] += widths.reduce((a, b) => a + b, 0) < total ? 1 : (widths[k % n] > min ? -1 : 0);
		const cells = suggestions.slice(0, n).map((x, i) => {
			const inner = widths[i] - 5, rows = wrapAnsi(x, inner);
			if (rows.length > 3) { rows.length = 3; rows[2] = `${cut(rows[2], inner - 1)}…`; }
			return rows;
		});
		const height = Math.max(...cells.map((c) => c.length));
		for (let r = 0; r < height; r++)
			extra.push(cells.map((c, i) => `${bg(P.userBg)}${r ? "   " : ` ${S.mag}${i + 1}${S.text} `}${S.text}${pad(c[r] ?? "", widths[i] - 3)}${R}`).join(" "));
	}
	if (attached.length) extra.push(`${S.mag}📎 ${R}${S.text}${attached.map((a) => `${a.name} ${Math.round(a.data.length * 0.75 / 1024)}KB`).join(" · ")}${R}${S.dim}  (invio le manda · ctrl+u a prompt vuoto le toglie)${R}`);
	// Narrow terminals: only the timeout bar stays above the prompt; other widgets (memory progress…) live in the panel (alt+s).
	// /btw answer: a card in the chat column (never in the panel, where it was clipped or hidden), shown until /btw or esc on an empty prompt.
	if (widgets.has("btw")) {
		const bl = [];
		for (const l of widgets.get("btw")) bl.push(...wrapAnsi(`${S.text}${l}${R}`, leftW - 2, 2));
		const room = Math.max(4, Math.floor(H * 0.4)), shown = bl.length > room ? [...bl.slice(0, room - 1), `${S.dim}… (${bl.length - room + 1} righe in più)${R}`] : bl;
		extra.push(`${S.mag}${"─".repeat(Math.max(0, leftW))}${R}`);
		for (const l of shown) extra.push(`${S.mag}▍${R} ${pad(l, leftW - 2)}`);
	}
	// Background commands (pi-ui widget "bg-tasks"): one dim row each, just above the prompt, also next to the side panel.
	if (widgets.has("bg-tasks")) for (const [i, l] of widgets.get("bg-tasks").entries()) extra.push(cut(`${S.cyan}${i ? " " : "⏵"} ${S.dim}${i ? "" : "background · "}${l}${R}`, leftW));
	if (!side && widgets.has("timeout-bar")) for (const l of widgets.get("timeout-bar")) extra.push(cut(l, leftW));
	if (!side && W < 100 && panelOff) { for (const l of sideLines(leftW - 1).slice(0, 14)) extra.push(cut(l, leftW)); }
	if (running && !side) {
		// Never leave the user blind: say what Pi did last and how long ago.
		const quiet = Math.floor((Date.now() - (sigAt || startedAt)) / 1000);
		extra.push(`${S.mag}◇ ${S.dim}${quiet >= 3 ? `no output for ${quiet}s` : "receiving"} · last: ${sigWhat || "waiting for model"}${R}`);
	}
	// Notices (startup warnings, errors) get their own row above the prompt, never inside the status bar.
	// Toast slide: enters/leaves in ~180 ms by revealing the card row by row from the bottom; frames are scheduled only while it moves.
	const nowMs = Date.now();
	if (toast !== toastSeen) { if (toast) { toastText = toast; toastT0 = nowMs; toastOut = 0; const shown = toast; setTimeout(() => { if (toast === shown) { toast = ""; schedule(); } }, 8000).unref(); } else if (toastText) toastOut = nowMs; toastSeen = toast; }
	let toastP = 1;
	if (toastText) {
		toastP = ANIM ? Math.min(1, (nowMs - (toastOut || toastT0)) / 180) : 1;
		if (toastOut) { toastP = ANIM ? 1 - toastP : 0; if (toastP <= 0) toastText = ""; }
		// Keep frames coming until the slide ends, including its first frame (entry p=0, exit p=1).
		if (toastText && (toastOut ? toastP > 0 : toastP < 1) && typeof schedule === "function") schedule();
	}
	const card = toastText && W >= 80;
	if (toast && !card) extra.push(cut(`${S.warn}⚠ ${toast}${R}`, leftW));
	const elapsed = running ? Math.floor((Date.now() - startedAt) / 1000) : 0;
	// Items with a priority (low = kept longest): when the line is too wide the least important drop first.
	const bitem = [
		[5, `${bg(P.codeBg)}${S.mag}\x1b[1m ${bootVersion ? `v${bootVersion} · ` : ""}${cut(process.cwd().split(/[\\/]/).filter(Boolean).pop() || "/", 24)}${git.branch && !side ? ` ⎇ ${cut(git.branch, 20)}` : ""} ${R}`],
		[0, yolo ? `${S.err}\x1b[1mSENZA PERMESSI${R}${S.dim}` : ""],
		[0, running ? `${S.mag}${ANIM ? SPIN[tickNow() % SPIN.length] : "●"} working ${elapsed}s${S.dim}${sigAt ? ` · ${Math.max(0, Math.floor((Date.now() - sigAt) / 1000))}s since ${sigWhat}` : ""}${queued ? ` · ${S.warn}${queued} in coda (alt+${NOW_ALT} now)${S.dim}` : ""}${S.mag}` : `${S.ok}●${S.dim} idle`],
		[1, model],
		[6, sessionName ? sessionName.slice(0, 30) : ""],
		[2, !side && ctxPct != null ? `${heat(ctxPct)}ctx ${Math.round(ctxPct)}%${S.dim}` : ""],
		[4, !side && cost != null ? `$${cost.toFixed(2)}` : ""],
		[3, !side ? usageText : ""],
		...(side ? [] : [...statuses.values()].map((v) => [7, v])),
		[0, scroll ? `↑${scroll} (End)` : ""],
		[8, `ctrl+c ${running ? "abort" : "quit"}`],
	].filter((x) => x[1]);
	const sep = `${S.faint} │ ${S.dim}`;
	let line = bitem.map((x) => x[1]).join(sep);
	while (bitem.length > 1 && width_(line) > leftW) {
		let k = 0;
		bitem.forEach((x, i) => { if (x[0] >= bitem[k][0]) k = i; });
		bitem.splice(k, 1);
		line = bitem.map((x) => x[1]).join(sep);
	}
	const status = cut(`${S.dim}${line}${R}`, leftW);
	// Light frame: top rule with a label, a bar on the continuation lines, bottom rule (static strings, no extra work).
	const bc = S.faint;
	const ruleLen = Math.max(0, leftW - 1);
	let sepLine = `${bc}╭${"─".repeat(ruleLen)}${R}`;
	if (ANIM && running && ruleLen > 12) {
		// A 6-cell light sweeps along the top rule (8 fps, about 1 cell per tick).
		const at = tickNow() % (ruleLen + 6) - 6, a = Math.max(0, at), b = Math.min(ruleLen, at + 6);
		if (b > a) sepLine = `${bc}╭${"─".repeat(a)}${S.mag}${"━".repeat(b - a)}${bc}${"─".repeat(ruleLen - b)}${R}`;
	}
	const endLine = `${bc}╰${"─".repeat(Math.max(0, leftW - 1))}${R}`;
	const wrapped = hardWrap(input, leftW - 2);
	const pre = hardWrap(input.slice(0, cursor), leftW - 2);
	const crow = pre.length - 1, ccol = width_(pre[crow]);
	const start = Math.max(0, crow - 5);
	const promptLines = wrapped.slice(start, start + 6).map((l, i) => `${S.mag}${start + i === 0 ? "›" : `${bc}│`}${R} ${l}`);

	const chatRows = Math.max(1, H - extra.length - 1 - 1 - 1 - promptLines.length);
	const body = bodyLines(leftW);
	scroll = Math.max(0, Math.min(scroll, Math.max(0, body.length - chatRows)));
	const view = body.slice(Math.max(0, body.length - chatRows - scroll), body.length - scroll);
	while (view.length < chatRows) view.unshift("");

	const left = [...view.map((l) => cut(l, leftW)), ...extra, status, sepLine, ...promptLines, endLine];
	let next;
	if (side) {
		if (sideVer !== sideSeen || sideW !== side) { sideCache = sideLines(side - 1).map((l) => cut(l, side - 1)); sideSeen = sideVer; sideW = side; }
		// Only the chat rows get the panel; the status, separator and prompt rows keep the full width.
		next = left.map((l, i) => (i < view.length + extra.length ? `${pad(l, leftW)}${S.faint} │ ${R}${sideCache[i] ?? ""}` : l));
	} else next = left;
	if (card) {
		// Toast card on the top center, composited into the rows before the diff: only these rows are rewritten, when it shows or hides.
		const kind = SEV[sevOf(toastText)]; // {c, i}
		const inner = Math.max(18, Math.min(44, Math.floor(W / 2) - 6, width_(toastText) + 2));
		// The text column is inner - 2 wide (icon + spaces): wrapping at inner pushed the right border out.
		const tw = inner - 2, wrapped = wrap(toastText, tw), lines = wrapped.slice(0, 3);
		if (wrapped.length > 3) lines[2] = cut(lines[2], tw - 1) + "…";
		const boxW = inner + 4, x = Math.max(0, Math.floor((W - boxW) / 2));
		const rows = [`${kind.c}╭${"─".repeat(boxW - 2)}╮${R}`, ...lines.map((l, i) => `${kind.c}│${R}${bg(P.userBg)} ${i ? " " : `${kind.c}${kind.i}${R}${bg(P.userBg)}`} ${S.text}${pad(l, inner - 2)} ${R}${kind.c}│${R}`), `${kind.c}╰${"─".repeat(boxW - 2)}╯${R}`];
		const shown = Math.max(1, Math.ceil(toastP * rows.length));
		rows.slice(rows.length - shown).forEach((box, r) => { if (next[r + 1] !== undefined && !MARK.test(next[r + 1])) next[r + 1] = `${pad(cut(next[r + 1], x), x)}${box}`; });
	}
	let buf = "";
	for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) buf += `${ESC}${i + 1};1H${next[i].replace(MARK, "")}${ESC}K`;
	for (let i = next.length; i < previous.length; i++) buf += `${ESC}${i + 1};1H${ESC}K`;
	buf += placeImages(next, previous);
	buf += `${ESC}${next.length - 1 - promptLines.length + (crow - start) + 1};${3 + Math.min(ccol, leftW - 3)}H`;
	previous = next;
	if (buf) out.write(buf);
};

// /model [name]: no argument opens a picker, otherwise the first model whose id/name contains the text is selected.
let modelCmd = "";
function modelsReply(r) {
	const list = r.data?.models ?? [];
	if (!r.success || !list.length) { toast = "nessun modello disponibile"; return; }
	const label = (m) => `${m.id}${m.name && m.name !== m.id ? ` · ${m.name}` : ""}${m.id === model ? "  ◂" : ""}`;
	const set = (m) => send({ id: "setmodel", type: "set_model", provider: m.provider, modelId: m.id });
	if (modelCmd) {
		const q = modelCmd.toLowerCase();
		const hit = list.find((m) => m.id.toLowerCase() === q) ?? list.find((m) => `${m.id} ${m.name ?? ""}`.toLowerCase().includes(q));
		if (hit) set(hit); else toast = `modello non trovato: ${modelCmd}`;
		return;
	}
	const opts = list.map(label);
	dialog = { id: "local", method: "select", title: "Modello", options: opts, sel: Math.max(0, list.findIndex((m) => m.id === model)), local: (v) => { const m = list[opts.indexOf(v)]; if (m) set(m); } };
}
// Set by /custom-reload: this process only waits for the new client, it must not paint over it any more.
let restarting = false;
let timer, lastDraw = 0;
const schedule = () => {
	if (timer || restarting) return;
	// Streaming redraws are paced at half rate (keys redraw at once via drawNow): measured -21% client CPU, text still reads smoothly.
	const wait = Math.max(0, 1000 / (running && !process.env.PROTO_FPS ? FPS / 2 : FPS) - (Date.now() - lastDraw));
	timer = setTimeout(() => { timer = undefined; if (restarting) return; lastDraw = Date.now(); frame(); }, wait);
};
const drawNow = () => { if (restarting) return; lastDraw = Date.now(); frame(); };

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

let rxBuf = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	if (booting && !bootSeen) bootNote("Pi attivo, carico le estensioni");
	rxBuf += chunk;
	let at;
	while ((at = rxBuf.indexOf("\n")) >= 0) {
		const line = rxBuf.slice(0, at).replace(/\r$/, "");
		rxBuf = rxBuf.slice(at + 1);
		if (line) onRecord(JSON.parse(line));
	}
});
const onRecord = (r) => {
	if (r.type !== "response") { sigAt = Date.now(); sigWhat = r.type === "message_update" ? (r.assistantMessageEvent?.type ?? "update").replace(/_delta$/, "") : r.type === "tool_execution_start" ? `tool ${r.toolName}` : r.type.replace(/^(agent|tool_execution)_/, ""); }
	switch (r.type) {
		case "agent_start":
			running = true; startedAt = Date.now(); sigAt = Date.now(); sigWhat = "start"; open = undefined;
			break;
		case "message_start":
			if (queuedMsgs.length && r.message?.role === "user") deliver(textOf(r.message.content));
			break;
		case "message_update": {
			const e = r.assistantMessageEvent;
			if (e?.type === "text_delta") { append("assistant", e.delta); if (cockpit?.chat.busy) { const m = cockpit.chat.msgs; if (m.at(-1)?.role === "assistant") m.at(-1).text += e.delta; else m.push({ role: "assistant", text: e.delta }); schedule(); } }
			else if (e?.type === "thinking_delta") append("thinking", e.delta);
			if (e?.type === "text_delta" || e?.type === "thinking_delta") tokens.out += 1;
			break;
		}
		case "tool_execution_start":
			if (cockpit?.chat.busy) { cockpit.chat.msgs.push({ role: "tool", text: `${r.toolName} ${typeof r.args?.action === "string" ? r.args.action : ""}`.trim() }); schedule(); }
			open = undefined;
			blocks.push({ kind: "tool", id: r.toolCallId, name: r.toolName, args: r.args, text: "" });
			if (r.toolName === "ask_user_question" && Array.isArray(r.args?.questions) && r.args.questions.length && !dialog) { qz = qzMk(r.args.questions); dialog = { method: "quiz", z: qz }; }
			break;
		case "tool_execution_end": {
			open = undefined;
			if (r.toolName === "ask_user_question") { qz = undefined; if (dialog?.method === "quiz") dialog = undefined; }
			const t = blocks.findLast((b) => b.id === r.toolCallId);
			if (t) { t.failed = !!r.isError; t.done = true; t.ms = r.durationMs; if (r.result?.details?.patch) t.patch = r.result.details.patch; }
			if (r.toolName === "todo") planFrom(r.result?.details);
			if (r.toolName === "bash") testResult(t?.args?.command, (r.result?.content ?? []).map((c) => c.text ?? "").join("\n"), !!r.isError);
			for (const c of r.result?.content ?? []) if (c.type === "image" && c.data) addImage(c.data, c.mimeType ?? "image/png");
			break;
		}
		case "response":
			sideVer++;
			if (r.id === "flushq" || r.id === "flusha") flushReply(r);
			else if (r.id === "stats" && r.success) { ctxPct = r.data?.contextUsage?.percent ?? ctxPct; cost = r.data?.cost ?? cost; }
			else if (r.id === "state" && r.success) { if (booting) { booting = false; try { writeFileSync(bootFile, JSON.stringify({ ms: Date.now() - bootAt })); } catch {} previous = []; out.write(`${ESC}2J${ESC}?25h`); } if (running && r.data && r.data.isStreaming === false && !r.data.isCompacting && !r.data.pendingMessageCount && Date.now() - Math.max(startedAt, pollFrom) > 2500) { running = false; queued = 0; open = undefined; } // Pi is idle but we never saw agent_settled: unstick
				model = r.data?.model?.id ?? model; sessionFile = r.data?.sessionFile ?? sessionFile; sessionName = r.data?.sessionName ?? ""; }
			else if (r.id === "models") modelsReply(r);
			else if (r.command === "set_model" || r.id === "setmodel") { if (r.success) { model = r.data?.id ?? model; toast = `modello: ${model}`; } else toast = `errore: ${r.error ?? "modello non cambiato"}`; }
			else if (r.id === "switch" && r.success) { send({ id: "state", type: "get_state" }); send({ id: "msgs", type: "get_messages" }); }
			else if (r.id === "msgs" && r.success) loadMessages(r.data?.messages ?? []);
			else if (r.id === "cmds" && r.success) piHasNow = (r.data?.commands ?? []).some((c) => c.name === "now"), commands = [...commands, ...(r.data?.commands ?? [])].filter((c, i, a) => a.findIndex((x) => x.name === c.name) === i);
			else if (r.command === "prompt" && r.success === false && /streamingBehavior/.test(r.error ?? "") && sentPrompts.has(r.id)) { running = true; pollFrom = Date.now(); queued++; send({ ...sentPrompts.get(r.id), id: `${r.id}r`, streamingBehavior: "steer" }); }
			else if (r.command === "prompt" && r.success === false) toast = `errore: ${r.error ?? "prompt rifiutato"}`;
			break;
		case "queue_update": // Pi's own count of messages still waiting: drops to 0 when the model has them
			queued = (r.steering?.length ?? 0) + (r.followUp?.length ?? 0); sideVer++;
			break;
		case "extension_ui_request": {
			const m = r.method;
			sideVer++;
			if (qzIntercept(r)) break;
			if (booting) bootNote(m === "setStatus" || m === "setWidget" ? `estensione: ${r.statusKey ?? r.widgetKey}` : m === "notify" ? "estensioni: avvisi iniziali" : "estensioni in caricamento");
			if (m === "select") dialog = { id: r.id, method: m, title: r.title, options: r.options ?? [], sel: 0 };
			else if (m === "confirm") dialog = { id: r.id, method: m, title: r.title, message: r.message };
			else if (m === "input" || m === "editor") dialog = { id: r.id, method: m, title: r.title, text: r.prefill ?? r.text ?? "" };
			else if (m === "notify" && String(r.message ?? "").split("\n").length >= 4) dialog = { id: r.id, method: "pager", title: "", lines: String(r.message).split("\n"), top: 0 };
			else if (m === "notify") { toast = String(r.message ?? "").replace(/\s*\n\s*/g, " ").replace(/[\x00-\x1f]/g, ""); setTimeout(() => { toast = ""; schedule(); }, 8000).unref(); }
			else if (m === "setStatus") r.statusText ? statuses.set(r.statusKey, r.statusText) : statuses.delete(r.statusKey);
			else if (m === "setWidget") r.widgetLines?.length ? widgets.set(r.widgetKey, r.widgetLines) : widgets.delete(r.widgetKey);
			else if (m === "setTitle") { title = r.title ?? title; out.write(`\x1b]0;${r.title}\x07`); }
			else if (m === "set_editor_text") { input = r.text ?? ""; cursor = input.length; }
			if (dialog && dialog.id === r.id && r.timeout) setTimeout(() => { if (dialog?.id === r.id) { dialog = undefined; schedule(); } }, r.timeout).unref();
			break;
		}
		case "agent_settled": {
			if (cockpit) { cockpit.chat.busy = false; schedule(); }
			running = false; open = undefined; queued = 0;
			for (const p of queuedMsgs.splice(0)) blocks.push({ kind: "user", text: p.text });
			const last = blocks.findLast((b) => b.kind === "assistant");
			suggestions = last && last.text.includes(SUG) ? last.text.slice(last.text.indexOf(SUG) + SUG.length).split("\n").map((l) => /^\s*[-*•]\s+(.+?)\s*$/.exec(l)?.[1]).filter(Boolean).slice(0, 3) : [];
			if (Date.now() - startedAt > 30000) out.write("\x07"); // long turn over: bell
		}
			refreshStats(); refreshGit(); readUsage(); readIntent();
			break;
		default:
			return;
	}
	schedule();
};

const answer = (body) => {
	if (dialog.local) { const d = dialog; dialog = undefined; if (!body.cancelled) d.local(body.value); return; } send({ type: "extension_ui_response", id: dialog.id, ...body }); dialog = undefined; };
// Keys while a dialog is open (select / confirm / input / editor); returns true when consumed.
const dialogKey = (key, csi) => {
	if (!dialog) return false;
	const d = dialog;
	if (d.method === "quiz") { qzKey(d.z, key, csi); return true; }
	if (d.method === "pager") {
		const page = Math.max(3, (out.rows || 24) - 10);
		if (csi === "A") d.top = Math.max(0, d.top - 1);
		else if (csi === "B") d.top = Math.min(Math.max(0, d.lines.length - page), d.top + 1);
		else if (csi === "5~") d.top = Math.max(0, d.top - page);
		else if (csi === "6~" || key === " ") d.top = Math.min(Math.max(0, d.lines.length - page), d.top + page);
		else if (key === "\x1b" || key === "q" || key === "\r") dialog = undefined;
		return true;
	}
	if (d.method === "sessions") {
		const hits = sessionHits(d), page = Math.max(2, Math.floor(((out.rows || 24) - 16) / 3));
		if (csi === "A") d.sel = Math.max(0, d.sel - 1);
		else if (csi === "B") d.sel = Math.min(hits.length - 1, d.sel + 1);
		else if (csi === "5~") d.sel = Math.max(0, d.sel - page);
		else if (csi === "6~") d.sel = Math.min(hits.length - 1, d.sel + page);
		else if (key === "\x1b" && !csi) { if (d.query) { d.query = ""; d.sel = 0; } else dialog = undefined; }
		else if ((key === "\r" || key === "\n") && hits[d.sel]) { dialog = undefined; d.local(hits[d.sel]); }
		else if (key === "\x7f") { d.query = d.query.slice(0, -1); d.sel = 0; }
		else if (key && key >= " " && !csi) { d.query += key; d.sel = 0; }
		return true;
	}
	if (csi === "A" && d.method === "select") d.sel = Math.max(0, d.sel - 1);
	else if (csi === "B" && d.method === "select") d.sel = Math.min(d.options.length - 1, d.sel + 1);
	else if (d.method === "select" && !csi && key >= "1" && key <= "9" && +key <= d.options.length) answer({ value: d.options[+key - 1] });
	else if (key === "\x1b" && !csi) answer({ cancelled: true });
	else if (key === "\r" || key === "\n") answer(d.method === "select" ? { value: d.options[d.sel] } : d.method === "confirm" ? { confirmed: true } : { value: d.text });
	else if (d.method === "confirm" && (key === "y" || key === "Y")) answer({ confirmed: true });
	else if (d.method === "confirm" && (key === "n" || key === "N")) answer({ confirmed: false });
	else if (d.text !== undefined && key === "\x7f") d.text = d.text.slice(0, -1);
	else if (d.text !== undefined && key && key >= " " && !csi) d.text += key;
	return true;
};

// --- Sessions: /resume lists the session files next to the current one; /name sets the display name.
const textOf = (c) => (typeof c === "string" ? c : (c ?? []).filter((x) => x.type === "text").map((x) => x.text).join(""));
const planFrom = (d) => {
	if (!d || !Array.isArray(d.tasks)) return;
	plan = d.tasks.filter((t) => t.status !== "deleted").map((t) => ({ subject: String(t.subject ?? ""), status: String(t.status ?? "pending") }));
	sideVer++;
};
// Newest in-progress intent: title and how many "Outcome atteso" boxes are ticked.
const readIntent = () => {
	try {
		for (const f of readdirSync("intents").filter((n) => n.endsWith(".md")).sort().reverse()) {
			const t = readFileSync(join("intents", f), "utf8");
			if (!/^status:\s*in-progress/m.test(t)) continue;
			const sec = /## Outcome atteso([\s\S]*?)(\n## |$)/.exec(t)?.[1] ?? "";
			const boxes = sec.match(/^- \[[ x]\]/gm) ?? [];
			intentInfo = { title: f, done: boxes.filter((b) => b.includes("x")).length, total: boxes.length };
			return;
		}
	} catch {}
	intentInfo = undefined;
};
const loadMessages = (msgs) => {
	plan = [];
	blocks.length = 0; queuedMsgs.length = 0; open = undefined; previous = []; out.write(`${ESC}2J`);
	for (const m of msgs) {
		if (m.role === "user") { const t = textOf(m.content); if (t) blocks.push({ kind: "user", text: t }); }
		else if (m.role === "assistant") {
			for (const c of m.content ?? []) {
				if (c.type === "text" && c.text) blocks.push({ kind: "assistant", text: c.text });
				else if (c.type === "thinking" && c.thinking) blocks.push({ kind: "thinking", text: c.thinking });
				else if (c.type === "toolCall") blocks.push({ kind: "tool", id: c.id, name: c.name, args: c.arguments, text: "", done: true });
			}
		} else if (m.role === "toolResult") {
			const t = blocks.findLast((b) => b.id === m.toolCallId);
			if (t) { t.failed = !!m.isError; if (m.details?.patch) t.patch = m.details.patch; }
			if (m.toolName === "todo") planFrom(m.details);
		}
	}
	scroll = 0; sideVer++;
};
const ago = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? "ora" : m < 60 ? `${m} min fa` : m < 1440 ? `${Math.round(m / 60)} h fa` : m < 10080 ? `${Math.round(m / 1440)} g fa` : new Date(ms).toISOString().slice(0, 10); };
const listSessions = () => {
	if (!sessionFile) return [];
	const dir = dirname(sessionFile);
	return readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== sessionFile).map((f) => { const st = statSync(join(dir, f)); return { f: join(dir, f), t: st.mtimeMs, size: st.size }; }).sort((a, b) => b.t - a.t).slice(0, 40).map((x) => {
		let name = "", first = "", last = "", msgs = 0;
		for (const l of readFileSync(x.f, "utf8").split("\n")) {
			if (!l) continue;
			let o; try { o = JSON.parse(l); } catch { continue; }
			if (o.type === "session_info" && o.name) name = o.name;
			else if (o.type === "message" && o.message?.role === "user") { const t = textOf(o.message.content).replace(/\s+/g, " ").trim(); if (t) { msgs++; if (!first) first = t; last = t; } }
		}
		if (!name && !first) return undefined;
		return { ...x, title: (name || first).slice(0, 120), first: first.slice(0, 120), last: last.slice(0, 120), msgs, sub: `${ago(x.t)} · ${msgs} ${msgs === 1 ? "domanda" : "domande"} · ${x.size < 1048576 ? `${Math.max(1, Math.round(x.size / 1024))} KB` : `${(x.size / 1048576).toFixed(1)} MB`}`, hay: `${name} ${first} ${last}`.toLowerCase() };
	}).filter(Boolean);
};
const resume = () => {
	let list;
	try { list = listSessions(); } catch (e) { toast = `resume: ${e.code ?? e.message}`; return; }
	if (!list.length) { toast = "nessuna sessione"; return; }
	dialog = { id: "local", method: "sessions", title: "Riprendi sessione", items: list, query: "", sel: 0, local: (hit) => send({ id: "switch", type: "switch_session", sessionPath: hit.f }) };
	sideVer++;
};
const sessionHits = (d) => { const q = d.query.toLowerCase().split(/\s+/).filter(Boolean); return q.length ? d.items.filter((x) => q.every((w) => x.hay.includes(w))) : d.items; };

// --- Keyboard.
// /custom-reload: relaunch this client on the same session (new Pi process: extensions, settings, bridge reloaded).
const restart = () => {
	const args = process.argv.slice(2).filter((a, i, all) => a !== "--no-session" && a !== "--session" && all[i - 1] !== "--session" && a !== "-c" && a !== "--continue");
	if (sessionFile) args.push("--session", sessionFile);
	if (yolo) env.PI_YOLO = "1"; else delete env.PI_YOLO;
	restarting = true;
	try { child.kill(); } catch {}
	process.stdin.pause(); process.stdin.removeAllListeners("data");
	out.write(`${ESC}?2004l${ESC}?1006l${ESC}?1000l${ESC}?1049l${ESC}?25h`);
	if (process.stdin.isTTY) process.stdin.setRawMode(false);
	const next = spawn(process.execPath, [process.argv[1], ...args], { stdio: "inherit", env });
	next.on("exit", (c) => process.exit(c ?? 0));
};
if (process.env.PROTO_DUMP) process.on("SIGUSR1", () => writeFileSync(process.env.PROTO_DUMP, previous.join("\n").replace(STRIP, ""))); // pty.py `snap`
let quitting = false;
const quit = () => {
	quitting = true;
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
// The agent can be busy without a turn we saw (compaction, extension work, two quick prompts): Pi then refuses the
// prompt asking for streamingBehavior; the refused prompts are resent as follow-ups.
const sentPrompts = new Map();
let promptSeq = 0;
const sendPrompt = (cmd) => {
	const id = `p${++promptSeq}`;
	sentPrompts.set(id, cmd);
	if (sentPrompts.size > 20) sentPrompts.delete(sentPrompts.keys().next().value);
	if (running) { queued++; sideVer++; }
	// While Pi works, a message is a steer (like Claude Code): the model reads it after the current tool calls, without
	// stopping the run. A follow-up would wait for the whole run to end.
	send({ ...cmd, id, ...(running ? { streamingBehavior: "steer" } : {}) });
};
// Steers wait for the running tool to end (a bash can last minutes). alt+n or /now (without pi-ui) takes Pi's queue back
// (clear_queue), aborts the run (the running tool is cancelled) and sends the queue plus the editor text as one prompt.
let flushExtra = "", flushImages = [], flushMsgs;
const flushNow = () => {
	const text = input.trim();
	if (!running) { if (text || attached.length) submit(); return; }
	if (!queued && !text && !attached.length) { toast = "niente in coda"; return; }
	if (text || attached.length) {
		if (text && hist[hist.length - 1] !== text) hist.push(text);
		hIdx = hist.length; draft = ""; input = ""; cursor = 0; scroll = 0; popDismissed = "";
		queue(text || "(immagine)", text || "Describe this image.");
		flushImages = attached.splice(0).map((a) => { addImage(a.data, a.mime); return { type: "image", data: a.data, mimeType: a.mime }; });
	}
	flushExtra = text;
	toast = "interrompo e invio subito…";
	send({ id: "flushq", type: "clear_queue" });
};
const flushReply = (r) => {
	if (r.id === "flushq") {
		const msgs = r.success ? [...(r.data?.steering ?? []), ...(r.data?.followUp ?? [])] : [];
		if (flushExtra) msgs.push(flushExtra);
		flushExtra = ""; queued = 0;
		if (!msgs.length && !flushImages.length) { toast = "coda già letta dal modello"; return; }
		flushMsgs = msgs;
		send({ id: "flusha", type: "abort" });
	} else if (r.id === "flusha") {
		const message = flushMsgs?.join("\n\n") || "Describe this image.", images = flushImages;
		flushMsgs = undefined; flushImages = [];
		running = false; // abort answers once Pi is idle: a plain prompt, not a steer
		sendPrompt({ type: "prompt", message, ...(images.length ? { images } : {}) });
	}
};
// Send now, like Claude Code: Pi's /now (pi-ui) moves running bash commands to the background and hands the queue
// over in the same turn, or interrupts when nothing can move. The editor text rides along as the command argument.
// Without pi-ui (no /now command) flushNow above does the interrupting version on its own.
let piHasNow = false;
// Send-now key: alt+<letter>, PI_NOW_KEY overrides (alt+n/alt+i clash with window managers like komorebi). ctrl+enter and /now always work.
const NOW_ALT = /^[a-z]$/.test(process.env.PI_NOW_KEY ?? "") && !"vsa".includes(process.env.PI_NOW_KEY) ? process.env.PI_NOW_KEY : "d";
const nowKey = () => {
	const text = input.trim();
	if (!running) { if (text || attached.length) submit(); return; }
	if (!piHasNow) { flushNow(); return; }
	if (attached.length) submit(); // images travel as a steer, /now then takes them with the queue
	else if (text) {
		if (hist[hist.length - 1] !== text) hist.push(text);
		hIdx = hist.length; draft = ""; input = ""; cursor = 0; scroll = 0; popDismissed = "";
		queue(text);
	} else if (!queued) { toast = "niente in coda"; return; }
	send({ type: "prompt", message: attached.length || !text ? "/now" : `/now ${text}` });
	toast = "invio subito…";
};
const submit = () => {
	const text = input.trim();
	if (!text && !attached.length) return;
	if (hist[hist.length - 1] !== text) hist.push(text);
	hIdx = hist.length; draft = "";
	input = ""; cursor = 0; scroll = 0; popDismissed = ""; suggestions = [];
	if (/^\/(quit|exit)$/.test(text)) return quit();
	if (text === "/clear") { blocks.length = 0; queuedMsgs.length = 0; open = undefined; previous = []; out.write(`${ESC}2J`); return; }
	if (text === "/new") { send({ type: "new_session" }); sessionName = ""; send({ id: "state", type: "get_state" }); blocks.length = 0; queuedMsgs.length = 0; open = undefined; previous = []; out.write(`${ESC}2J`); return; }
	if (text === "/resume") { resume(); return; }
	if (text === "/auto" && statuses.get("auto-run")) { cockpitOpen(); return; }
	const np0 = /^\/model(?:\s+(.+))?$/.exec(text);
	if (np0) { modelCmd = np0[1]?.trim() ?? ""; send({ id: "models", type: "get_available_models" }); return; }
	if (text === "/custom-reload") { if (running) { toast = "reload rifiutato: Pi sta lavorando (ctrl+c per fermarlo, poi riprova)"; schedule(); return; } restart(); return; }
	let np;
	if ((np = /^\/no-permissions\s*(on|off)?$/i.exec(text))) {
		yolo = np[1] ? np[1].toLowerCase() === "on" : !yolo;
		send({ type: "prompt", message: `/no-permissions ${yolo ? "on" : "off"}` });
		toast = yolo ? "senza permessi: attivo" : "senza permessi: spento";
		return;
	}
	let nm;
	if ((nm = /^\/name\s+(.+)$/.exec(text))) { send({ type: "set_session_name", name: nm[1] }); sessionName = nm[1]; sideVer++; return; }
	if (text === "/now") { input = ""; nowKey(); return; }
	if (text === "/compact") { send({ type: "compact" }); toast = "compatto…"; return; }
	let m;
	if ((m = /^\/img\s+(\S+)\s*(.*)$/.exec(text))) {
		try {
			const path = m[1].replace(/^@/, ""), data = readFileSync(path).toString("base64");
			const mime = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
			if (running) queue(m[2] || path, m[2] || "Describe this image."); else blocks.push({ kind: "user", text: m[2] || path });
			addImage(data, mime);
			sendPrompt({ type: "prompt", message: m[2] || "Describe this image.", images: [{ type: "image", data, mimeType: mime }] });
		} catch (e) { toast = `img: ${e.code ?? e.message}`; }
		return;
	}
	if (running) queue(text || "(immagine)", text || "Describe this image.");
	else { blocks.push({ kind: "user", text: text || "(immagine)" }); open = undefined; }
	const images = attached.splice(0).map((a) => { addImage(a.data, a.mime); return { type: "image", data: a.data, mimeType: a.mime }; });
	sendPrompt({ type: "prompt", message: text || "Describe this image.", ...(images.length ? { images } : {}) });
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
const re = new RegExp(/\x1b_G([^\x1b]*)\x1b\\|\x1b\[\?([0-9;]*)c|\x1b\[200~([\s\S]*?)\x1b\[201~|\x1b\[<(\d+);\d+;\d+[Mm]|\x1b\[([0-9;]*)([A-Za-z~])|(\x1b[\r\nvs])|([\s\S])/.source.replace("vs]", `vsa${NOW_ALT}]`), "gu");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
	re.lastIndex = 0;
	let m;
	while ((m = re.exec(data))) {
		if (m[1] !== undefined) { // kitty graphics reply to our query: it understands the protocol
			if (/^i=31;OK/.test(m[1])) imageProto = "kitty";
			continue;
		}
		if (m[2] !== undefined) { // device attributes reply (always the last answer): attribute 4 = sixel
			if (imageProto === "?") imageProto = "none";
			sideVer++;
			continue;
		}
		if (m[3] !== undefined) { // bracketed paste: literal text, newlines kept
			const t = m[3].replace(/\r\n?/g, "\n");
			if (cockpit) { const c = cockpit; if (c.chat.typing !== null) c.chat.typing += t.replace(/\n/g, " "); else if (c.ui.note !== null) c.ui.note += t.replace(/\n/g, " "); drawNow(); }
			else if (dialog?.text !== undefined) dialog.text += t.replace(/\n/g, " ");
			else if (!dialog && !t.trim()) pasteClipboardImage(); // image-only clipboard: terminals paste nothing, read the image
			else if (!dialog && !attachFile(t)) insert(t);
		} else if (m[4] !== undefined) { // SGR mouse: 64 wheel up, 65 wheel down
			if (m[4] === "64") scroll += 3;
			else if (m[4] === "65") scroll = Math.max(0, scroll - 3);
		} else if (m[6] !== undefined) {
			if (cockpit) { cockpitKey(undefined, m[5] + m[6]); drawNow(); continue; }
			if (dialogKey(undefined, m[5] + m[6])) continue;
			const k = m[5] + m[6];
			if (m[6] === "t") { const q = /^6;(\d+);(\d+)$/.exec(m[5]); if (q) { cellH = Number(q[1]) || cellH; cellW = Number(q[2]) || cellW; } continue; }
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
			else if (k === "13;5u") nowKey();
			else if (k === "A") { if (items) popSel = (popSel + items.length - 1) % items.length; else if (!input.includes("\n")) histMove(-1); else cursor = Math.max(0, input.lastIndexOf("\n", cursor - 1)); }
			else if (k === "B") { if (items) popSel = (popSel + 1) % items.length; else if (!input.includes("\n")) histMove(1); else { const n = input.indexOf("\n", cursor); cursor = n < 0 ? input.length : n + 1; } }
		} else if (m[7] !== undefined) { if (cockpit) continue; if (m[7][1] === "a") cockpitOpen(); else if (m[7][1] === NOW_ALT) nowKey(); else if (m[7][1] === "v") pasteClipboardImage();
		else if (m[7][1] === "s") { panelOff = !panelOff; previous = []; out.write(`${ESC}2J`); } else insert("\n"); }
		else {
			const key = m[8];
			if (booting) { if (key === "\x03") return quit(); continue; } // nothing to type into yet
			if (cockpit) { if (key === "\x03") return quit(); cockpitKey(key); drawNow(); continue; }
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
			else if (key === "\x1b") { popDismissed = input; if (!input && widgets.has("btw")) { widgets.delete("btw"); sideVer++; } }
			else if (key === "\x0f") expandSteps = !expandSteps;
			else if (key === "\x14") showThinking = !showThinking;
			else if (key === "\x7f") { if (cursor > 0) { input = input.slice(0, cursor - 1) + input.slice(cursor); cursor--; popSel = 0; popDismissed = ""; } }
			else if (key === "\x15") { if (!input && attached.length) attached.length = 0; else { input = input.slice(cursor); cursor = 0; } }
			else if (key === "\x0b") input = input.slice(0, cursor);
			else if (key === "\x17") { const i = wordLeft(); input = input.slice(0, i) + input.slice(cursor); cursor = i; }
			else if (key === "\x01") cursor = 0;
			else if (key === "\x05") cursor = input.length;
			else if (key === "\x10") histMove(-1);
			else if (key === "\x0e") histMove(1);
			else if (key === "\x16") pasteClipboardImage();
			else if (key >= "1" && key <= "3" && !input && suggestions[+key - 1]) { input = suggestions[+key - 1]; cursor = input.length; suggestions = []; }
			else if (key >= " ") { insert(key); popDismissed = ""; }
		}
	}
	drawNow();
});
out.on("resize", () => { previous = []; shownKitty = new Set(); if (imageProto === "kitty") out.write("\x1b_Ga=d,d=A,q=2\x1b\\"); out.write(`${ESC}2J`); drawNow(); });
child.on("exit", (code, sig) => {
	if (restarting) return;
	dialog = undefined;
	if (!quitting) {
		const msg = `pi terminated unexpectedly (code ${code ?? "-"}, signal ${sig ?? "-"})\n${errTail.trim()}`;
		try { writeFileSync(join(homedir(), ".pi", "agent", "proto-last-exit.log"), `${new Date().toISOString()}\n${msg}\n`); } catch {}
		quit(); out.write(`\n${msg}\n(log: ~/.pi/agent/proto-last-exit.log)\n`);
		return;
	}
});
out.write(`${ESC}?1049h${ESC}?1000h${ESC}?1006h${ESC}?2004h${ESC}2J`);
drawNow();
// Ask the terminal: kitty graphics query (1x1 pixel) then device attributes; the replies set imageProto.
out.write("\x1b[16t\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c");
// 1 s heartbeat only while a turn runs: keeps the working timer and the "no output for Ns" line alive when Pi is silent.
setInterval(() => { if (running && Date.now() - lastPoll > 3000) { lastPoll = Date.now(); send({ id: "state", type: "get_state" }); } if (running || booting) schedule(); }, ANIM ? 125 : 1000).unref();
setTimeout(() => { if (imageProto === "?") { imageProto = "none"; sideVer++; schedule(); } }, 1500).unref();

send({ id: "state", type: "get_state" });
send({ id: "msgs", type: "get_messages" }); // resumed sessions (--session, -c, /custom-reload) start with history
send({ id: "cmds", type: "get_commands" });
refreshStats();
refreshGit();
readUsage();
readIntent();
