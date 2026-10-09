/**
 * Episodic memory: the past sessions of the project, searched only when the model asks (`ricorda` with `episodio`).
 * Sessions are cut into windows of a few messages (user and assistant text, no tool output); each window is indexed
 * with the same recall as memories (keywords, entities), once per file and modification time. The answer is the best
 * window or two, with the session's date, clipped: the passage that answers, not the whole conversation.
 */
import { readFileSync, statSync } from "node:fs";
import { RecallIndex, recall } from "./recall.ts";
import type { MemoryRecord } from "./store.ts";

const WINDOW = 4;
const MAX_CHARS = 1500;

export interface EpisodeHit {
	file: string;
	date: string;
	text: string;
	score: number;
}

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n")
			: "";

function windows(file: string): MemoryRecord[] {
	const messages: { at: string; line: string }[] = [];
	for (const raw of readFileSync(file, "utf8").split("\n")) {
		if (!raw.trim()) continue;
		let record: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
		try {
			record = JSON.parse(raw);
		} catch {
			continue;
		}
		if (record.type !== "message" || !record.message) continue;
		const role = record.message.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = textOf(record.message.content).trim();
		if (text) messages.push({ at: record.timestamp ?? "", line: `${role === "user" ? "Utente" : "Pi"}: ${text.length > 600 ? `${text.slice(0, 599)}…` : text}` });
	}
	const out: MemoryRecord[] = [];
	// Overlapping windows (step half a window): an answer is never cut away from its question.
	for (let start = 0; start < messages.length; start += Math.max(1, WINDOW / 2)) {
		const slice = messages.slice(start, start + WINDOW);
		if (slice.length === 0) break;
		const date = (slice[0].at || "").slice(0, 10);
		out.push({ id: `${file}#${start}`, type: "episodio", text: slice.map((message) => message.line).join("\n"), pinned: false, confirmations: 1, created: date, last: date, status: "active", entities: [] });
		if (start + WINDOW >= messages.length) break;
	}
	return out;
}

export class EpisodeSearch {
	private cache = new Map<string, { mtime: number; records: MemoryRecord[] }>();
	private index: { key: string; index: RecallIndex } | undefined;

	search(files: string[], query: string, today = new Date().toISOString().slice(0, 10), limit = 2): EpisodeHit[] {
		const all: MemoryRecord[] = [];
		const keys: string[] = [];
		for (const file of files) {
			let mtime = 0;
			try {
				mtime = statSync(file).mtimeMs;
			} catch {
				continue;
			}
			let cached = this.cache.get(file);
			if (cached?.mtime !== mtime) {
				cached = { mtime, records: windows(file) };
				this.cache.set(file, cached);
			}
			all.push(...cached.records);
			keys.push(`${file}:${mtime}`);
		}
		const key = keys.join("|");
		if (this.index?.key !== key) this.index = { key, index: new RecallIndex(all) };
		const hits = recall(this.index.index, query, { today, threshold: 0.3, inquiryThreshold: 0, limit, deep: false }).hits;
		return hits.map(({ record, score }) => ({ file: record.id.split("#")[0], date: record.created, text: record.text.length > MAX_CHARS ? `${record.text.slice(0, MAX_CHARS - 1)}…` : record.text, score }));
	}
}
