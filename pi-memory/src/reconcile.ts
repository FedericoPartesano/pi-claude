/** Bridge between the deep store and the consolidation core (applyProposal works on entries, ids by position). */
import type { MemoryEntry } from "../../extensions/memory-core.ts";
import { extractEntities } from "./entities.ts";
import { highestId, type MemoryRecord } from "./store.ts";

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
export function entriesToRecords(memory: MemoryEntry[], archive: MemoryEntry[], prev: MemoryRecord[], today: string, after = 0): MemoryRecord[] {
	const before = new Map(prev.map((record) => [record.id, record]));
	let counter = Math.max(after, highestId(prev.map((record) => record.id)));
	const taken = new Set<string>();
	/** Additions of this /dream ("new:k") → the ids they get here, to resolve links between them. */
	const fresh = new Map<string, string>();
	const idFor = (entry: MemoryEntry) => {
		let id = entry.id;
		if (!id || id.startsWith("new:") || taken.has(id)) id = `r${++counter}`;
		if (entry.id?.startsWith("new:")) fresh.set(entry.id, id);
		taken.add(id);
		return id;
	};
	/** Replaced id (updated, merged away) → the id of what replaces it: links to it follow. */
	const redirect = new Map<string, string>();
	const base = (entry: MemoryEntry, id: string): MemoryRecord => {
		const old = before.get(id);
		// An update or a merge: the new memory inherits the replaced ones' links and usage.
		const replaced = (entry.replaces ?? []).map((replacedId) => before.get(replacedId)).filter((record): record is MemoryRecord => Boolean(record));
		for (const record of replaced) redirect.set(record.id, id);
		const inherited = replaced.length
			? {
					...(replaced.some((record) => record.links?.length) ? { links: [...new Set(replaced.flatMap((record) => record.links ?? []))] } : {}),
					...(replaced.some((record) => record.uses) ? { uses: replaced.reduce((sum, record) => sum + (record.uses ?? 0), 0) } : {}),
					...(replaced.some((record) => record.lastUsed) ? { lastUsed: replaced.map((record) => record.lastUsed ?? "").sort().pop() } : {}),
					...(replaced[0].scope ? { scope: replaced[0].scope } : {}),
					created: replaced.map((record) => record.created).sort()[0],
				}
			: {};
		return {
			id,
			type: entry.type,
			text: entry.text,
			pinned: entry.pinned,
			confirmations: entry.confirmations,
			created: old?.created ?? (inherited as { created?: string }).created ?? today,
			last: entry.last || today,
			status: "active",
			entities: [...new Set([...(entry.entities ?? old?.entities ?? []).map((value) => value.toLowerCase()), ...extractEntities(entry.text)])],
			...(old?.source ? { source: old.source } : {}),
			// Graph, lifecycle and usage survive consolidation (they were dropped: every /dream erased the links). The
			// gist only while the text is the same.
			...(entry.links?.length || old?.links?.length || (inherited as { links?: string[] }).links ? { links: [...new Set([...(old?.links ?? []), ...((inherited as { links?: string[] }).links ?? []), ...(entry.links ?? [])])] } : {}),
			...(entry.gist ? { gist: entry.gist } : old?.gist && old.text === entry.text ? { gist: old.gist } : {}),
			...(old?.state ? { state: old.state, dormantSince: old.dormantSince } : {}),
			...(entry.level ?? old?.level ? { level: entry.level ?? old?.level } : {}),
			...(old?.uses ? { uses: old.uses } : (inherited as { uses?: number }).uses ? { uses: (inherited as { uses?: number }).uses } : {}),
			...(old?.lastUsed ? { lastUsed: old.lastUsed } : (inherited as { lastUsed?: string }).lastUsed ? { lastUsed: (inherited as { lastUsed?: string }).lastUsed } : {}),
			...(old?.scope ? { scope: old.scope } : (inherited as { scope?: string }).scope ? { scope: (inherited as { scope?: MemoryRecord["scope"] }).scope } : {}),
		};
	};
	const records: MemoryRecord[] = [];
	for (const entry of memory) records.push(base(entry, idFor(entry)));
	for (const entry of archive) {
		const record = base(entry, idFor(entry));
		if (!entry.reason || entry.reason === "episodio") records.push(record);
		else records.push({ ...record, status: "superseded", reason: entry.reason });
	}
	// Links: additions of this /dream resolved to their ids, links to replaced memories redirected to what replaces
	// them, and links to memories that are not active anymore (or never existed) pruned.
	const active = new Set(records.filter((record) => record.status === "active").map((record) => record.id));
	const follow = (link: string) => {
		let target: string | undefined = link.startsWith("new:") ? fresh.get(link) : link;
		for (let hops = 0; target && redirect.has(target) && hops < 10; hops++) target = redirect.get(target);
		return target;
	};
	// What replaced a superseded memory (followed to the end): a pin given to it meanwhile moves there (rebaseOnCurrent).
	for (const record of records) {
		if (record.status !== "superseded" || !redirect.has(record.id)) continue;
		const target = follow(record.id);
		if (target && target !== record.id) record.supersededBy = target;
	}
	for (const record of records) {
		if (!record.links?.length) continue;
		const links = [...new Set(record.links.map(follow).filter((link): link is string => link !== undefined && link !== record.id && active.has(link)))];
		if (links.length) record.links = links;
		else delete record.links;
	}
	return records;
}

/**
 * Memories /dream marked "personale" while consolidating a project (language, style, personal tools): they hold in every
 * project, so they move to the global store, renumbered after its highest id.
 */
export function movePersonal(project: MemoryRecord[], global: MemoryRecord[], after = 0): { project: MemoryRecord[]; global: MemoryRecord[]; moved: number } {
	const personal = project.filter((record) => record.level === "personale" && record.status === "active");
	if (personal.length === 0) return { project, global, moved: 0 };
	let counter = Math.max(after, highestId(global.map((record) => record.id)));
	// Links point to project memories: meaningless in the global store.
	const moved = personal.map(({ links: _links, ...record }) => ({ ...record, id: `r${++counter}` }));
	return { project: project.filter((record) => !personal.includes(record)), global: [...global, ...moved], moved: moved.length };
}

const sameRecord = (a: MemoryRecord | undefined, b: MemoryRecord | undefined) => JSON.stringify(a) === JSON.stringify(b);
const idNumber = (id: string) => Number(/^r(\d+)$/.exec(id)?.[1] ?? 0);

/**
 * One memory changed both by the user (saved) and by the dream (next), from the same starting point (old). The user's
 * text or status change wins whole (they decided what the memory says); otherwise field by field: what the user changed
 * (a pin) wins, the rest is the dream's (reinforcement, links, gist, its supersession). Before, the saved copy won
 * whole, and a pin made while the dream superseded the memory brought the old text back next to its replacement.
 */
function threeWay(old: MemoryRecord, saved: MemoryRecord, dream: MemoryRecord): MemoryRecord {
	if (saved.text !== old.text || saved.status !== old.status) return saved;
	const result: Record<string, unknown> = { ...dream };
	for (const key of new Set([...Object.keys(old), ...Object.keys(saved)])) {
		const was = (old as unknown as Record<string, unknown>)[key];
		const is = (saved as unknown as Record<string, unknown>)[key];
		if (JSON.stringify(was) !== JSON.stringify(is)) {
			if (is === undefined) delete result[key];
			else result[key] = is;
		}
	}
	return result as unknown as MemoryRecord;
}

/**
 * /dream reads the store, waits minutes for the model, then saves: whatever was saved meanwhile (an edit, a pin or a
 * deletion in /memory, another session's /dream) must survive. `next` was computed from `previous`; `current` is the
 * store now. Deletions and the user's changes win over the dream; memories added elsewhere are kept with their ids, and
 * the dream's own new memories are renumbered if their ids are taken.
 */
export function rebaseOnCurrent(previous: MemoryRecord[], current: MemoryRecord[], next: MemoryRecord[], after = 0): MemoryRecord[] {
	const before = new Map(previous.map((record) => [record.id, record]));
	const now = new Map(current.map((record) => [record.id, record]));
	if (previous.length === current.length && previous.every((record) => sameRecord(record, now.get(record.id)))) return next;
	const merged: MemoryRecord[] = [];
	const renamed = new Map<string, string>();
	let counter = after;
	for (const record of [...current, ...next]) counter = Math.max(counter, idNumber(record.id));
	const taken = new Set(current.map((record) => record.id));
	/** Records carrying the dream's links (its own, or merged with the user's pin): their links follow renamed ids. */
	const fromDream = new Set<MemoryRecord>();
	for (const record of next) {
		const old = before.get(record.id);
		if (old) {
			// Existed when the dream started: deleted since → stays deleted; changed since → the change wins.
			const saved = now.get(record.id);
			if (!saved) continue;
			if (sameRecord(saved, old)) merged.push(record);
			else {
				const result = threeWay(old, saved, record);
				merged.push(result);
				if (result === saved) continue; // the user's version: its links are theirs
			}
			fromDream.add(merged[merged.length - 1]);
			continue;
		}
		// The dream's own addition: a new id if another writer took this one meanwhile.
		if (taken.has(record.id)) {
			const id = `r${++counter}`;
			renamed.set(record.id, id);
			merged.push({ ...record, id });
		} else merged.push(record);
		fromDream.add(merged[merged.length - 1]);
		taken.add(merged[merged.length - 1].id);
	}
	// Memories that did not exist when the dream started (another session's /dream, an addition in /memory).
	for (const record of current) if (!before.has(record.id)) merged.push(record);
	// A pin given to a memory the dream superseded meanwhile belongs to its replacement.
	const byId = new Map(merged.map((record) => [record.id, record]));
	for (const [index, record] of merged.entries()) {
		const replacement = record.supersededBy ? byId.get(renamed.get(record.supersededBy) ?? record.supersededBy) : undefined;
		if (record.status !== "superseded" || !record.pinned || !replacement) continue;
		merged[index] = { ...record, pinned: false };
		if (fromDream.has(record)) fromDream.add(merged[index]);
		const at = merged.indexOf(replacement);
		merged[at] = { ...replacement, pinned: true };
		if (fromDream.has(replacement)) fromDream.add(merged[at]);
		byId.set(replacement.id, merged[at]);
	}
	if (renamed.size === 0) return merged;
	return merged.map((record) => {
		if (!fromDream.has(record)) return record;
		const links = record.links?.some((link) => renamed.has(link)) ? { links: record.links.map((link) => renamed.get(link) ?? link) } : {};
		const supersededBy = record.supersededBy && renamed.has(record.supersededBy) ? { supersededBy: renamed.get(record.supersededBy) } : {};
		return Object.keys(links).length || Object.keys(supersededBy).length ? { ...record, ...links, ...supersededBy } : record;
	});
}
