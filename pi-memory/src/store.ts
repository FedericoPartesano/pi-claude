/** On-disk store: memories.jsonl (one record per line, no cap) + vectors.json (base64 float32 per id). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMemory } from "../../extensions/memory-core.ts";
import { extractEntities } from "./entities.ts";

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
}

export interface Store {
	records: MemoryRecord[];
	vectors: Map<string, Float32Array>;
	model?: string;
}

const paths = (dir: string) => ({ jsonl: join(dir, "memories.jsonl"), vectors: join(dir, "vectors.json") });

export const storeExists = (dir: string) => existsSync(paths(dir).jsonl);

export function loadStore(dir: string, idPrefix = ""): Store {
	const { jsonl, vectors: vectorsFile } = paths(dir);
	const records: MemoryRecord[] = [];
	if (existsSync(jsonl)) {
		for (const line of readFileSync(jsonl, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as MemoryRecord;
				records.push({ ...record, id: idPrefix + record.id, entities: record.entities ?? [] });
			} catch {
				// A corrupt line must not lose the others.
			}
		}
	}
	const vectors = new Map<string, Float32Array>();
	let model: string | undefined;
	if (existsSync(vectorsFile)) {
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

const writeAtomic = (path: string, text: string) => {
	writeFileSync(`${path}.tmp`, text);
	renameSync(`${path}.tmp`, path);
};

export function saveStore(dir: string, store: Store) {
	mkdirSync(dir, { recursive: true });
	const { jsonl, vectors } = paths(dir);
	writeAtomic(jsonl, store.records.map((record) => `${JSON.stringify(record)}\n`).join(""));
	const known = new Set(store.records.map((record) => record.id));
	const encoded: Record<string, string> = {};
	for (const [id, vector] of store.vectors) if (known.has(id)) encoded[id] = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64");
	writeAtomic(vectors, JSON.stringify({ model: store.model, vectors: encoded }));
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
