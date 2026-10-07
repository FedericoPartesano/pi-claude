/** Bridge between the deep store and the consolidation core (applyProposal works on entries, ids by position). */
import type { MemoryEntry } from "../../extensions/memory-core.ts";
import { extractEntities } from "./entities.ts";
import type { MemoryRecord } from "./store.ts";

export function recordsToEntries(records: MemoryRecord[]): { memory: MemoryEntry[]; archive: MemoryEntry[] } {
	const memory: MemoryEntry[] = [];
	const archive: MemoryEntry[] = [];
	for (const record of records) {
		const entry: MemoryEntry = { id: record.id, type: record.type, text: record.text, pinned: record.pinned, confirmations: record.confirmations, last: record.last };
		if (record.entities.length > 0) entry.entities = record.entities;
		if (record.status === "active") memory.push(entry);
		else archive.push({ ...entry, archived: record.last, reason: record.reason ?? "superato" });
	}
	return { memory, archive };
}

/** Rebuilds records after applyProposal: ids are kept, new entries get fresh ids, merged-away ones disappear. */
export function entriesToRecords(memory: MemoryEntry[], archive: MemoryEntry[], prev: MemoryRecord[], today: string): MemoryRecord[] {
	const before = new Map(prev.map((record) => [record.id, record]));
	let counter = Math.max(0, ...prev.map((record) => Number(/^r(\d+)$/.exec(record.id)?.[1] ?? 0)));
	const taken = new Set<string>();
	const idFor = (entry: MemoryEntry) => {
		let id = entry.id;
		if (!id || taken.has(id)) id = `r${++counter}`;
		taken.add(id);
		return id;
	};
	const base = (entry: MemoryEntry, id: string): MemoryRecord => {
		const old = before.get(id);
		return {
			id,
			type: entry.type,
			text: entry.text,
			pinned: entry.pinned,
			confirmations: entry.confirmations,
			created: old?.created ?? today,
			last: entry.last || today,
			status: "active",
			entities: [...new Set([...(entry.entities ?? old?.entities ?? []).map((value) => value.toLowerCase()), ...extractEntities(entry.text)])],
			...(old?.source ? { source: old.source } : {}),
		};
	};
	const records: MemoryRecord[] = [];
	for (const entry of memory) records.push(base(entry, idFor(entry)));
	for (const entry of archive) {
		const record = base(entry, idFor(entry));
		if (!entry.reason || entry.reason === "episodio") records.push(record);
		else records.push({ ...record, status: "superseded", reason: entry.reason });
	}
	return records;
}
