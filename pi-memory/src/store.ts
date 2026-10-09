/**
 * On-disk store: memories.jsonl (one record per line, no cap) + vectors.bin (contiguous float32) with vectors.idx.json
 * (model, dimension, ids in order). The old vectors.json (base64 per id) is still read and replaced on the next save.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMemory } from "../../extensions/memory-core.ts";
import { extractEntities } from "./entities.ts";
import { inferScope, type MemoryScope } from "./request.ts";

export interface MemoryRecord {
	id: string;
	type: string;
	text: string;
	pinned: boolean;
	confirmations: number;
	created: string;
	last: string;
	status: "active" | "superseded";
	supersededBy?: string;
	reason?: string;
	entities: string[];
	source?: string;
	/** sempre = holds for any code change in the project; contesto (default) = only when relevant. */
	scope?: MemoryScope;
	/** One short line (<= 90 chars) shown as a cue; the full text is one `ricorda` away. */
	gist?: string;
	/** Ids of related memories (explains, depends on, contradicts): the memory graph. */
	links?: string[];
	/** Dormant: out of the cues, still found by `ricorda`; forgotten later if never used. */
	state?: "dormant";
	/** When it went dormant (YYYY-MM-DD). */
	dormantSince?: string;
	/** Set on records of forgotten.jsonl: out of the store and the cues, still found by a deep search. */
	forgottenAt?: string;
	/** personale = holds in every project (lives in the global store). */
	level?: "progetto" | "personale";
	/** Times the model actually used it (opened with `ricorda`), and when last. */
	uses?: number;
	lastUsed?: string;
}

export interface Store {
	records: MemoryRecord[];
	vectors: Map<string, Float32Array>;
	model?: string;
}

const paths = (dir: string) => ({ jsonl: join(dir, "memories.jsonl"), vectors: join(dir, "vectors.json"), bin: join(dir, "vectors.bin"), idx: join(dir, "vectors.idx.json") });

export const storeExists = (dir: string) => existsSync(paths(dir).jsonl);

/** The memories only (no vectors): what a writer must re-read under the lock, fast. */
export function loadRecords(dir: string): MemoryRecord[] {
	const { jsonl } = paths(dir);
	if (!existsSync(jsonl)) return [];
	const records: MemoryRecord[] = [];
	for (const line of readFileSync(jsonl, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const record = JSON.parse(line) as MemoryRecord;
			records.push({ ...record, entities: record.entities ?? [] });
		} catch {
			// A corrupt line must not lose the others.
		}
	}
	return records;
}

export function loadStore(dir: string, idPrefix = ""): Store {
	const { jsonl, vectors: vectorsFile } = paths(dir);
	const records: MemoryRecord[] = [];
	if (existsSync(jsonl)) {
		for (const line of readFileSync(jsonl, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as MemoryRecord;
				records.push({ ...record, id: idPrefix + record.id, entities: record.entities ?? [], scope: record.scope ?? inferScope(record.type, record.text), ...(idPrefix && record.links ? { links: record.links.map((link) => idPrefix + link) } : {}) });
			} catch {
				// A corrupt line must not lose the others.
			}
		}
	}
	const vectors = new Map<string, Float32Array>();
	let model: string | undefined;
	const { bin, idx } = paths(dir);
	// A vectors.json still present was never migrated (every save removes it): it wins over the binary file.
	if (!existsSync(vectorsFile) && existsSync(bin) && existsSync(idx)) {
		try {
			const index = JSON.parse(readFileSync(idx, "utf8")) as { model?: string; dim: number; ids: string[] };
			const bytes = readFileSync(bin);
			// One copy into an aligned buffer, then views: no per-vector allocation of the data.
			const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
			model = index.model;
			index.ids.forEach((id, position) => {
				if ((position + 1) * index.dim <= all.length) vectors.set(idPrefix + id, all.subarray(position * index.dim, (position + 1) * index.dim));
			});
		} catch {
			// Vectors are recomputable.
		}
	} else if (existsSync(vectorsFile)) {
		try {
			const raw = JSON.parse(readFileSync(vectorsFile, "utf8")) as { model?: string; vectors: Record<string, string> };
			model = raw.model;
			for (const [id, encoded] of Object.entries(raw.vectors)) {
				const bytes = Buffer.from(encoded, "base64");
				vectors.set(idPrefix + id, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
			}
		} catch {
			// Vectors are recomputable.
		}
	}
	return { records, vectors, model };
}

/** Atomic replace; the temp name carries the pid so two writers (two Pi sessions) never share it. */
const writeAtomic = (path: string, text: string) => {
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, text);
	renameSync(temp, path);
};

export function saveStore(dir: string, store: Store) {
	mkdirSync(dir, { recursive: true });
	// The last id ever given, kept apart: a memory merged away or forgotten must not hand its number to a new one.
	const last = Math.max(lastId(dir), highestId(store.records.map((record) => record.id)));
	writeAtomic(join(dir, "ids.json"), JSON.stringify({ last }));
	writeAtomic(paths(dir).jsonl, store.records.map((record) => `${JSON.stringify(record)}\n`).join(""));
	saveVectors(dir, store.records, store.vectors, store.model);
}

/** Only the vector files (the memories are not rewritten): vectors of records that exist, one dimension. */
export function saveVectors(dir: string, records: Pick<MemoryRecord, "id">[], vectorsById: Map<string, Float32Array>, model: string | undefined) {
	mkdirSync(dir, { recursive: true });
	const { vectors, bin, idx } = paths(dir);
	const known = new Set(records.map((record) => record.id));
	const kept = [...vectorsById].filter(([id]) => known.has(id));
	const dim = kept[0]?.[1].length ?? 0;
	const same = kept.filter(([, vector]) => vector.length === dim);
	const data = new Float32Array(same.length * dim);
	same.forEach(([, vector], position) => data.set(vector, position * dim));
	const temp = `${bin}.${process.pid}.tmp`;
	writeFileSync(temp, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
	renameSync(temp, bin);
	writeAtomic(idx, JSON.stringify({ model, dim, ids: same.map(([id]) => id) }));
	if (existsSync(vectors)) rmSync(vectors, { force: true });
}

/** Text that gets embedded: the memory plus its keywords (they widen the semantic net for paraphrased requests). */
export const embedText = (record: Pick<MemoryRecord, "text" | "entities">) => (record.entities.length > 0 ? `${record.text} (${record.entities.join(", ")})` : record.text);

/** Active records still without an embedding (new, edited, or the model changed). */
export function missingVectors(store: Store): MemoryRecord[] {
	return store.records.filter((record) => record.status === "active" && !store.vectors.has(record.id));
}

/** Drops vectors of records whose text changed (or that vanished): they are recomputed. */
export function pruneVectors(prev: MemoryRecord[], next: MemoryRecord[], vectors: Map<string, Float32Array>): Map<string, Float32Array> {
	const before = new Map(prev.map((record) => [record.id, record.text]));
	const kept = new Map<string, Float32Array>();
	for (const record of next) {
		const vector = vectors.get(record.id);
		if (vector && before.get(record.id) === record.text) kept.set(record.id, vector);
	}
	return kept;
}

/** Archive lines that are not "superseded": the old cap and fading no longer exist in the deep store. */
export const STILL_ACTIVE_REASON = /^(episodio|oltre il tetto|sbiadito)/;

/** One-time import of memory.md / memory-archive.md. Returns true when something was migrated. */
export function migrateLegacy(storeDir: string, memoryFile: string, archiveFile: string, today: string): boolean {
	if (storeExists(storeDir)) return false;
	const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
	const memory = parseMemory(read(memoryFile));
	const archive = parseMemory(read(archiveFile));
	if (memory.length + archive.length === 0) return false;
	let counter = 0;
	const make = (entry: (typeof memory)[number], active: boolean): MemoryRecord => ({
		id: `r${++counter}`,
		type: entry.type,
		text: entry.text,
		pinned: entry.pinned,
		confirmations: entry.confirmations,
		created: entry.last || today,
		last: entry.last || today,
		status: active ? "active" : "superseded",
		...(active || !entry.reason ? {} : { reason: entry.reason }),
		entities: extractEntities(entry.text),
		source: "migrated",
	});
	const records = [...memory.map((entry) => make(entry, true)), ...archive.map((entry) => make(entry, !entry.reason || STILL_ACTIVE_REASON.test(entry.reason)))];
	saveStore(storeDir, { records, vectors: new Map() });
	return true;
}

/** The highest "r<n>" number among ids (a loop: Math.max(...ids) overflows the stack on very large stores). */
export function highestId(ids: Iterable<string>): number {
	let highest = 0;
	for (const id of ids) {
		const number = Number(/^r(\d+)$/.exec(id)?.[1] ?? 0);
		if (number > highest) highest = number;
	}
	return highest;
}

/** The last "r<n>" number given in this store: ids.json, and forgotten.jsonl for stores saved before it existed. */
export function lastId(dir: string): number {
	let last = 0;
	try {
		last = Number((JSON.parse(readFileSync(join(dir, "ids.json"), "utf8")) as { last?: number }).last ?? 0) || 0;
	} catch {
		// No ids.json yet.
	}
	const forgotten = join(dir, "forgotten.jsonl");
	if (existsSync(forgotten)) {
		const ids: string[] = [];
		for (const line of readFileSync(forgotten, "utf8").split("\n")) {
			try {
				if (line.trim()) ids.push((JSON.parse(line) as { id: string }).id);
			} catch {
				// A corrupt line.
			}
		}
		last = Math.max(last, highestId(ids));
	}
	return last;
}
