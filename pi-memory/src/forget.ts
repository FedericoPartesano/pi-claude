/**
 * Forgetting, like a person: what is not confirmed or used for months goes dormant (out of the cues, still found by
 * `ricorda`), and what stays dormant and unused for months more is forgotten (out of the store, kept aside to restore).
 * What the code no longer has (every file a memory cites is gone) goes dormant at once. Pinned memories and corrections
 * confirmed twice are never forgotten. Runs at /dream: memory grows in depth, not in noise.
 */
import type { MemoryRecord } from "./store.ts";

export const DORMANT_AFTER_DAYS = 90;
export const FORGET_AFTER_DAYS = 90;

const days = (from: string | undefined, to: string) => (from ? (Date.parse(to) - Date.parse(from)) / 86_400_000 : Number.POSITIVE_INFINITY);
const latest = (...dates: (string | undefined)[]) => dates.filter(Boolean).sort().pop();
/** Entities that are file paths (a folder and an extension): the ones that can disappear from the project. */
const isPath = (entity: string) => /\//.test(entity) && /\.[a-z0-9]{1,6}$/i.test(entity);

export interface Lifecycle {
	records: MemoryRecord[];
	dormant: string[];
	woken: string[];
	forgotten: MemoryRecord[];
}

export function lifecycle(records: MemoryRecord[], today: string, options: { fileExists?: (path: string) => boolean } = {}): Lifecycle {
	const result: Lifecycle = { records: [], dormant: [], woken: [], forgotten: [] };
	for (const record of records) {
		const protectedForever = record.pinned || (record.type === "correzione" && record.confirmations >= 2);
		if (record.status !== "active" || protectedForever) {
			result.records.push(record);
			continue;
		}
		const lastTouch = latest(record.last, record.lastUsed, record.created);
		if (record.state === "dormant") {
			// Confirmed or used after it went dormant: awake again.
			if (record.dormantSince && lastTouch && lastTouch > record.dormantSince) {
				const { state: _state, dormantSince: _since, ...awake } = record;
				result.records.push(awake);
				result.woken.push(record.id);
			} else if (days(record.dormantSince, today) >= FORGET_AFTER_DAYS) result.forgotten.push(record);
			else result.records.push(record);
			continue;
		}
		const paths = record.entities.filter(isPath);
		const codeGone = Boolean(options.fileExists) && paths.length > 0 && paths.every((path) => !options.fileExists!(path));
		if (codeGone || days(lastTouch, today) >= DORMANT_AFTER_DAYS) {
			result.records.push({ ...record, state: "dormant", dormantSince: today });
			result.dormant.push(record.id);
		} else result.records.push(record);
	}
	return result;
}

/**
 * Usage from the recall log: a memory that reached the cues of a request was useful that day. lastUsed is idempotent;
 * uses counts only events after `since` (the last event already counted), so running it at every /dream does not
 * count the same request twice.
 */
export function applyUsage(records: MemoryRecord[], events: { at: string; hits: { id: string }[] }[], prefix: string, since = ""): MemoryRecord[] {
	const last = new Map<string, string>();
	const counts = new Map<string, number>();
	for (const event of events) {
		const day = event.at.slice(0, 10);
		for (const hit of event.hits) {
			if (prefix ? !hit.id.startsWith(prefix) : hit.id.includes(":")) continue;
			const id = hit.id.slice(prefix.length);
			if ((last.get(id) ?? "") < day) last.set(id, day);
			if (event.at > since) counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return records.map((record) => {
		const day = last.get(record.id);
		const count = counts.get(record.id) ?? 0;
		if (!day && !count) return record;
		return { ...record, uses: (record.uses ?? 0) + count, lastUsed: day && day > (record.lastUsed ?? "") ? day : record.lastUsed };
	});
}
