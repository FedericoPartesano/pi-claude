/** Glue between store, embedder and recall: cached loading, background vector filling, recall log. */
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Embedder } from "./embed.ts";
import { CORE_BUDGET_CHARS, RecallIndex, coreIds, coreSection, recall, renderRecall, type Scored } from "./recall.ts";
import { embedText, loadStore, missingVectors, saveStore, type MemoryRecord } from "./store.ts";

export interface StoreDirs {
	project: string;
	global?: string;
}

const isReady = (embedder: Embedder | undefined) => Boolean(embedder) && (embedder as { ready?: boolean }).ready !== false;
const stamp = (dir: string) => ["memories.jsonl", "vectors.json"].map((name) => (existsSync(join(dir, name)) ? statSync(join(dir, name)).mtimeMs : 0)).join(":");

/** Embeds the active records that have no vector yet (or all of them when the model changed). Returns how many. */
export async function fillVectors(dir: string, embedder: Embedder): Promise<number> {
	const store = loadStore(dir);
	if (store.model !== embedder.model) store.vectors.clear();
	const todo = missingVectors(store);
	if (todo.length === 0) return 0;
	for (let start = 0; start < todo.length; start += 32) {
		const batch = todo.slice(start, start + 32);
		const vectors = await embedder.embed(batch.map(embedText), "passage");
		batch.forEach((record, i) => store.vectors.set(record.id, vectors[i]));
	}
	saveStore(dir, { ...store, model: embedder.model });
	return todo.length;
}

export interface RecallRun {
	text: string;
	hits: Scored[];
	ids: string[];
	chars: number;
	estTokens: number;
	embedderReady: boolean;
	ms: number;
}

export class Recaller {
	private cache = new Map<string, { stamp: string; index: RecallIndex; vectors: Map<string, Float32Array>; model?: string; records: MemoryRecord[] }>();

	private load(dir: string, prefix: string) {
		const key = `${prefix}${dir}`;
		const current = stamp(dir);
		const cached = this.cache.get(key);
		if (cached?.stamp === current) return cached;
		const store = loadStore(dir, prefix);
		const entry = { stamp: current, index: new RecallIndex(store.records), vectors: store.vectors, model: store.model, records: store.records };
		this.cache.set(key, entry);
		return entry;
	}

	private all(dirs: StoreDirs) {
		const parts = [this.load(dirs.project, "")];
		if (dirs.global) parts.push(this.load(dirs.global, "g:"));
		return parts;
	}

	/** True when some store already has embeddings (otherwise waiting for the model would bring nothing). */
	hasVectors(dirs: StoreDirs): boolean {
		return this.all(dirs).some((part) => part.vectors.size > 0);
	}

	/** Pinned memories for the system prompt (stable text, small). */
	core(dirs: StoreDirs): string | undefined {
		return coreSection(this.all(dirs).flatMap((part) => part.records));
	}

	async run(query: string, dirs: StoreDirs, today: string, embedder?: Embedder, options: { includeSuperseded?: boolean; threshold?: number } = {}): Promise<RecallRun> {
		const started = performance.now();
		const parts = this.all(dirs);
		const records = parts.flatMap((part) => part.records);
		const ready = isReady(embedder);
		const vectors = new Map<string, Float32Array>();
		for (const part of parts) if (embedder && part.model === embedder.model) for (const [id, vector] of part.vectors) vectors.set(id, vector);
		let queryVector: Float32Array | undefined;
		if (ready && vectors.size > 0) {
			try {
				queryVector = (await embedder!.embed([query], "query"))[0];
			} catch {
				queryVector = undefined;
			}
		}
		// Pinned memories already sit in the system prompt: never repeat them in the request.
		const pinned = new Set(coreIds(records));
		const index = parts.length === 1 ? parts[0].index : new RecallIndex(records);
		const { hits } = recall(index, query, { today, vectors, queryVector, semFloor: embedder?.semFloor, semSpan: embedder?.semSpan, includeSuperseded: options.includeSuperseded, threshold: options.threshold, exclude: options.includeSuperseded ? undefined : pinned });
		const text = renderRecall(hits);
		return { text, hits, ids: text ? hits.map((hit) => hit.record.id).slice(0, text.split("\n").length - 1) : [], chars: text.length, estTokens: Math.round(text.length / 3.6), embedderReady: Boolean(queryVector), ms: Math.round((performance.now() - started) * 10) / 10 };
	}
}

export { CORE_BUDGET_CHARS };

export function appendRecallLog(dir: string, line: { mode: string; query: string; injected: string[]; chars: number; estTokens: number; embedderReady: boolean; ms: number }) {
	try {
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "recall-log.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), ...line, query: line.query.slice(0, 120) })}\n`);
	} catch {
		// Logging never breaks a request.
	}
}
