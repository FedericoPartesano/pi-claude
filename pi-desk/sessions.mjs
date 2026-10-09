/**
 * Pi's sessions on this machine (~/.pi/agent/sessions/<project>/<date>_<id>.jsonl): the list for the sidebar, which ones
 * a Pi is running right now, and a session's transcript read incrementally (a running one is followed as it grows).
 * Read only: a session another Pi is writing is never written here.
 */
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");
const HEAD_BYTES = 256 * 1024;

function readHead(path, bytes = HEAD_BYTES) {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(Math.min(bytes, fstatSync(fd).size));
		readSync(fd, buffer, 0, buffer.length, 0);
		return buffer.toString("utf8");
	} finally {
		closeSync(fd);
	}
}

const textOf = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.filter((block) => block?.type === "text").map((block) => block.text).join("\n") : "");

/** Header, title (the session's name, else its first user message) and dates of one session file. */
export function summarize(path) {
	const lines = readHead(path).split("\n");
	let header;
	let title = "";
	let name = "";
	for (const line of lines) {
		if (!line.trim()) continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue; // the head may end mid-line
		}
		if (record.type === "session") header = record;
		else if (record.type === "session_info" && record.name) name = record.name;
		else if (!title && record.type === "message" && record.message?.role === "user") title = textOf(record.message.content).trim();
	}
	if (!header) return undefined;
	const cwd = header.cwd ?? "";
	return { path, id: header.id, cwd, project: basename(cwd) || cwd, created: header.timestamp, modified: statSync(path).mtimeMs, title: (name || title || "(senza messaggi)").replace(/\s+/g, " ").slice(0, 140) };
}

/** Summaries by file, reused while the file keeps its size and date (the sidebar refreshes every few seconds). */
const summaries = new Map();

function cachedSummary(path, stat) {
	const cached = summaries.get(path);
	if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) return cached.summary;
	const summary = summarize(path);
	summaries.set(path, { size: stat.size, mtime: stat.mtimeMs, summary });
	return summary;
}

/** Every session, most recently active first. */
export function listSessions(root = SESSIONS_ROOT, limit = 300) {
	if (!existsSync(root)) return [];
	const files = [];
	for (const dir of readdirSync(root, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		for (const file of readdirSync(join(root, dir.name))) {
			if (!file.endsWith(".jsonl")) continue;
			const path = join(root, dir.name, file);
			try {
				const stat = statSync(path);
				files.push({ path, modified: stat.mtimeMs, stat });
			} catch {
				// Removed meanwhile.
			}
		}
	}
	files.sort((a, b) => b.modified - a.modified);
	return files
		.slice(0, limit)
		.map(({ path, stat }) => {
			try {
				return cachedSummary(path, stat);
			} catch {
				return undefined;
			}
		})
		.filter(Boolean);
}

/** Pi processes running now (Linux and WSL, from /proc): their folder and when they started. Elsewhere: none. */
export function runningPi() {
	if (!existsSync("/proc/self")) return [];
	const out = [];
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const name = readFileSync(`/proc/${entry}/comm`, "utf8").trim();
			if (name !== "pi") continue;
			out.push({ pid: Number(entry), cwd: readlinkSync(`/proc/${entry}/cwd`), started: statSync(`/proc/${entry}`).ctimeMs });
		} catch {
			// Gone, or not ours.
		}
	}
	return out;
}

/**
 * Marks the session each running Pi is writing: in its folder, the one written most recently since it started (a
 * resumed session was created before, but is written now). ownPid: the Pi of this window.
 */
export function markRunning(sessions, processes, ownPid) {
	const marks = new Map();
	for (const proc of processes) {
		const candidates = sessions.filter((session) => session.cwd === proc.cwd && session.modified >= proc.started - 5000).sort((a, b) => b.modified - a.modified);
		if (candidates[0]) marks.set(candidates[0].path, { pid: proc.pid, own: proc.pid === ownPid });
	}
	return sessions.map((session) => (marks.has(session.path) ? { ...session, running: marks.get(session.path) } : session));
}

function briefArgs(args = {}) {
	const value = args.command ?? args.path ?? args.url ?? args.query ?? args.pattern ?? args.action ?? "";
	return String(value).replace(/\s+/g, " ").slice(0, 100);
}

/**
 * The readable part of a session from a byte offset: user and assistant text, tool calls in brief. Returns the new
 * offset (only complete lines are consumed), so a running session is followed by reading again from there.
 */
export function readTranscript(path, offset = 0) {
	const fd = openSync(path, "r");
	let text;
	try {
		const size = fstatSync(fd).size;
		if (size <= offset) return { items: [], offset };
		const buffer = Buffer.alloc(size - offset);
		readSync(fd, buffer, 0, buffer.length, offset);
		text = buffer.toString("utf8");
	} finally {
		closeSync(fd);
	}
	const end = text.lastIndexOf("\n");
	if (end === -1) return { items: [], offset };
	const items = [];
	for (const line of text.slice(0, end).split("\n")) {
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record.type !== "message") continue;
		const message = record.message ?? {};
		if (message.role === "user") {
			const said = textOf(message.content).trim();
			if (said) items.push({ role: "user", text: said });
		} else if (message.role === "toolResult") {
			// Images a tool returned (read of a picture, a browser screenshot): on the tool's line, at most 3.
			const images = (Array.isArray(message.content) ? message.content : []).filter((block) => block?.type === "image" && block.data).slice(0, 3).map((block) => ({ data: block.data, mimeType: block.mimeType ?? "image/png" }));
			const tool = images.length ? items.findLast((item) => item.role === "tool" && (!message.toolCallId || item.id === message.toolCallId)) : undefined;
			if (tool) tool.images = images;
		} else if (message.role === "assistant") {
			const said = textOf(message.content).trim();
			if (said) items.push({ role: "assistant", text: said });
			for (const block of Array.isArray(message.content) ? message.content : []) if (block?.type === "toolCall") items.push({ role: "tool", id: block.id, text: `${block.name} ${briefArgs(block.arguments)}`.trim() });
			if (message.errorMessage) items.push({ role: "error", text: message.errorMessage });
		}
	}
	return { items, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
}
