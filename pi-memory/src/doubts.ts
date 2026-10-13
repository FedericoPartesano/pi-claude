/**
 * Doubts of /dream: when the model is not sure a memory still holds (the user seems to contradict it), it does not
 * change it; it leaves a question here (doubts.json, next to the store) and the user decides, with one answer each.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryAction } from "./dashboard.ts";
import type { MemoryRecord } from "./store.ts";

export interface Doubt {
	/** The memory the doubt is about (record id). */
	id: string;
	question: string;
	/** What the memory would become if the user says yes; without it, yes marks the memory as superseded. */
	text?: string;
	at: string;
}

/** Most questions asked in one go: the others wait for the next time. */
export const DOUBTS_PER_ROUND = 3;
const FILE = "doubts.json";

export function loadDoubts(dir: string): Doubt[] {
	const file = join(dir, FILE);
	if (!existsSync(file)) return [];
	try {
		const list = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return Array.isArray(list) ? list.filter((item): item is Doubt => typeof item?.id === "string" && typeof item?.question === "string") : [];
	} catch {
		return [];
	}
}

export function saveDoubts(dir: string, doubts: Doubt[]): void {
	writeFileSync(join(dir, FILE), `${JSON.stringify(doubts, null, 1)}\n`);
}

/** Adds doubts to the pending ones: one per memory (the newest question wins). */
export function mergeDoubts(current: Doubt[], added: Doubt[]): Doubt[] {
	const ids = new Set(added.map((doubt) => doubt.id));
	return [...current.filter((doubt) => !ids.has(doubt.id)), ...added];
}

/** The pending doubts still worth asking: the memory exists and is active. Oldest first, at most `limit`. */
export function askable(doubts: Doubt[], records: Pick<MemoryRecord, "id" | "status">[], limit = DOUBTS_PER_ROUND): Doubt[] {
	const active = new Set(records.filter((record) => record.status === "active").map((record) => record.id));
	return doubts.filter((doubt) => active.has(doubt.id)).slice(0, limit);
}

/** What "yes" does to the memory. */
export function doubtAction(doubt: Doubt): MemoryAction {
	return doubt.text ? { kind: "edit", text: doubt.text } : { kind: "supersede" };
}
