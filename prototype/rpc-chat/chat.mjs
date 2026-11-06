#!/usr/bin/env node
// Prototype: a chat UI written from scratch on top of `pi --mode rpc` (no pi-tui, no dependencies).
// Differential rendering: only the rows that changed are written; streaming redraws are capped (PROTO_FPS, default 30),
// key presses redraw at once. Usage: node chat.mjs [pi options, e.g. --model haiku]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FPS = Number(process.env.PROTO_FPS) || 30;
const piArgs = ["--mode", "rpc", "--no-session", ...process.argv.slice(2)];
const env = { ...process.env };
delete env.NODE_OPTIONS;
const child = spawn("pi", piArgs, { stdio: ["pipe", "pipe", "inherit"], env });

const out = process.stdout;
const ESC = "\x1b[";
const style = { user: "\x1b[1;36m", dim: "\x1b[2m", tool: "\x1b[33m", think: "\x1b[2;3m", reset: "\x1b[0m" };

// --- model of the conversation: a list of blocks; each block is {kind, text}.
const blocks = [];
let open; // block being streamed
let running = false;
let tokens = { in: 0, out: 0 };
let input = "";
let frames = 0;
let rows = 0;
let scroll = 0; // lines above the bottom; 0 = follow the stream
let cursor = 0;

const append = (kind, delta) => {
	if (!open || open.kind !== kind) {
		open = { kind, text: "" };
		blocks.push(open);
	}
	open.text += delta;
};

// --- Markdown (line based, streaming friendly) and ANSI-aware wrapping.
const ANSI = /\x1b\[[0-9;]*m/y;
const inline = (t) =>
	t
		.replace(/`([^`]+)`/g, "\x1b[38;5;215m$1\x1b[39m")
		.replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[22m")
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1\x1b[3m$2\x1b[23m");

// Wrap one styled line to `width` visible columns; open SGR state is carried over on continuation lines.
const wrapAnsi = (line, width) => {
	if (line.length <= width && !line.includes("\x1b")) return [line];
	const rowsOut = [];
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
		if (vis >= width) {
			if (lastSpace > 0) {
				rowsOut.push(cur.slice(0, lastSpace) + (active ? "\x1b[0m" : ""));
				cur = active + cur.slice(lastSpace + 1);
				vis -= lastSpaceVis + 1;
			} else {
				rowsOut.push(cur + (active ? "\x1b[0m" : ""));
				cur = active;
				vis = 0;
			}
			lastSpace = -1;
		}
		if (line[i] === " ") { lastSpace = cur.length; lastSpaceVis = vis; }
		cur += line[i++];
		vis++;
	}
	rowsOut.push(cur);
	return rowsOut;
};

const markdown = (text, width) => {
	const out = [];
	let fence = false;
	for (const raw of text.split("\n")) {
		if (/^```/.test(raw)) { fence = !fence; out.push(`${style.dim}${raw.slice(0, 3)}${raw.slice(3)}${style.reset}`); continue; }
		if (fence) { out.push(...wrapAnsi(`\x1b[38;5;110m  ${raw}\x1b[0m`, width)); continue; }
		let m;
		if ((m = /^(#{1,6})\s+(.*)/.exec(raw))) out.push(...wrapAnsi(`\x1b[1;4;35m${m[2]}\x1b[0m`, width));
		else if ((m = /^(\s*)[-*]\s+(.*)/.exec(raw))) out.push(...wrapAnsi(`${m[1]}\x1b[36m•\x1b[0m ${inline(m[2])}`, width));
		else if ((m = /^(\s*)(\d+)\.\s+(.*)/.exec(raw))) out.push(...wrapAnsi(`${m[1]}\x1b[36m${m[2]}.\x1b[0m ${inline(m[3])}`, width));
		else if ((m = /^>\s?(.*)/.exec(raw))) out.push(...wrapAnsi(`\x1b[2m│ \x1b[3m${inline(m[1])}\x1b[0m`, width));
		else out.push(...wrapAnsi(inline(raw), width));
	}
	return out;
};

const wrap = (text, width) => text.split("\n").flatMap((l) => (l ? wrapAnsi(l, width) : [""]));

// Wrapped lines of closed blocks are cached by (block, width): only the open block is re-rendered per frame.
const cache = new WeakMap();
const blockLines = (block, width) => {
	const done = block !== open;
	const hit = cache.get(block);
	if (done && hit && hit.width === width && hit.len === block.text.length) return hit.lines;
	const prefix = { user: "› ", thinking: "◇ ", tool: "⚙ " }[block.kind] ?? "";
	const color = { user: style.user, thinking: style.think, tool: style.tool }[block.kind] ?? "";
	const lines =
		block.kind === "assistant"
			? markdown(block.text, width)
			: wrap(prefix + block.text, width).map((l) => color + l + style.reset);
	lines.push("");
	if (done) cache.set(block, { width, len: block.text.length, lines });
	return lines;
};

let previous = [];
const frame = () => {
	frames++;
	const width = out.columns || 80;
	rows = out.rows || 24;
	const body = [];
	for (const block of blocks) body.push(...blockLines(block, width));
	const chatRows = rows - 2;
	scroll = Math.max(0, Math.min(scroll, Math.max(0, body.length - chatRows)));
	const view = body.slice(Math.max(0, body.length - chatRows - scroll), body.length - scroll);
	while (view.length < chatRows) view.unshift("");
	const status = `${style.dim}${running ? "● working" : "○ idle"} · ${tokens.out} tok out${scroll ? ` · ↑${scroll} (End: bottom)` : ""} · ctrl+c ${running ? "abort" : "quit"}${style.reset}`;
	const shown = input.slice(Math.max(0, cursor - width + 4));
	const prompt = `› ${shown}`;
	const caret = 3 + Math.min(cursor, width - 4);
	const next = [...view, status, prompt];
	let buf = "";
	for (let i = 0; i < next.length; i++) {
		if (previous[i] !== next[i]) buf += `${ESC}${i + 1};1H${next[i]}${ESC}K`;
	}
	buf += `${ESC}${rows};${caret}H`;
	previous = next;
	if (buf) out.write(buf);
};

let timer;
let lastDraw = 0;
const schedule = () => {
	if (timer) return;
	const wait = Math.max(0, 1000 / FPS - (Date.now() - lastDraw));
	timer = setTimeout(() => {
		timer = undefined;
		lastDraw = Date.now();
		frame();
	}, wait);
};
const drawNow = () => {
	lastDraw = Date.now();
	frame();
};

// --- RPC.
const send = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);
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
			running = true;
			open = undefined;
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
			blocks.push({ kind: "tool", text: `${r.toolName} ${JSON.stringify(r.args ?? {}).slice(0, 80)}` });
			break;
		case "tool_execution_end":
			open = undefined;
			break;
		case "agent_settled":
			running = false;
			open = undefined;
			break;
		default:
			return;
	}
	schedule();
};

// --- Keyboard.
const quit = () => {
	if (process.env.PROTO_DUMP) writeFileSync(process.env.PROTO_DUMP, previous.join("\n").replace(/\x1b\[[0-9;]*m/g, ""));
	try {
		const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1].split(" ");
		const hz = 100;
		const mine = process.cpuUsage();
		if (process.env.PROTO_CPU)
			writeFileSync(process.env.PROTO_CPU, JSON.stringify({ frames, clientMs: Math.round((mine.user + mine.system) / 1000), rpcMs: Math.round(((Number(stat[11]) + Number(stat[12])) / hz) * 1000) }));
	} catch {}
	out.write(`${ESC}?1006l${ESC}?1000l${ESC}?1049l${ESC}?25h`);
	child.stdin.end();
	setTimeout(() => process.exit(0), 200);
};
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
const page = () => Math.max(1, (out.rows || 24) - 4);
process.stdin.on("data", (data) => {
	const re = /\x1b\[<(\d+);\d+;\d+[Mm]|\x1b\[([0-9;]*)([A-Za-z~])|([\s\S])/gu;
	let m;
	while ((m = re.exec(data))) {
		if (m[1] !== undefined) { // SGR mouse: 64 wheel up, 65 wheel down
			if (m[1] === "64") scroll += 3;
			else if (m[1] === "65") scroll = Math.max(0, scroll - 3);
		} else if (m[3] !== undefined) {
			const k = m[2] + m[3];
			if (k === "D") cursor = Math.max(0, cursor - 1);
			else if (k === "C") cursor = Math.min(input.length, cursor + 1);
			else if (k === "H" || k === "1~") cursor = 0;
			else if (k === "F" || k === "4~") { cursor = input.length; scroll = 0; }
			else if (k === "3~") input = input.slice(0, cursor) + input.slice(cursor + 1);
			else if (k === "5~") scroll += page();
			else if (k === "6~") scroll = Math.max(0, scroll - page());
			else if (k === "A") scroll += 1;
			else if (k === "B") scroll = Math.max(0, scroll - 1);
		} else {
			const key = m[4];
			if (key === "\x03") {
				if (running) send({ type: "abort" });
				else return quit();
			} else if (key === "\x04") return quit();
			else if (key === "\r" || key === "\n") {
				if (!input.trim()) continue;
				blocks.push({ kind: "user", text: input });
				open = undefined;
				send({ type: "prompt", message: input, ...(running ? { streamingBehavior: "followUp" } : {}) });
				input = ""; cursor = 0; scroll = 0;
			} else if (key === "\x7f") { if (cursor > 0) { input = input.slice(0, cursor - 1) + input.slice(cursor); cursor--; } }
			else if (key === "\x15") { input = input.slice(cursor); cursor = 0; }
			else if (key === "\x01") cursor = 0;
			else if (key === "\x05") cursor = input.length;
			else if (key >= " " || key === "\t") { input = input.slice(0, cursor) + key + input.slice(cursor); cursor += key.length; }
		}
	}
	drawNow();
});
out.on("resize", () => {
	previous = [];
	out.write(`${ESC}2J`);
	drawNow();
});
child.on("exit", () => quit());
out.write(`${ESC}?1049h${ESC}?1000h${ESC}?1006h${ESC}2J`);
drawNow();
