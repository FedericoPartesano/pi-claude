/** Glue between store, embedder and recall: cached loading, background vector filling, recall log. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Embedder } from "./embed.ts";
import { CORE_BUDGET_CHARS, RecallIndex, coreIds, coreSection, cueLimit, recall, renderCues, type Scored } from "./recall.ts";
import { embedText, loadStore, missingVectors, saveStore, type MemoryRecord } from "./store.ts";

export interface StoreDirs {
	project: string;
	global?: string;
}

const isReady = (embedder: Embedder | undefined) => Boolean(embedder) && (embedder as { ready?: boolean }).ready !== false;
const stamp = (dir: string) => ["memories.jsonl", "vectors.json", "vectors.idx.json", "gist.md"].map((name) => (existsSync(join(dir, name)) ? statSync(join(dir, name)).mtimeMs : 0)).join(":");

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

	private cold = new Map<string, { stamp: number; index: RecallIndex }>();

	/** forgotten.jsonl of the stores, for deep searches only (keyword index; their vectors were dropped). */
	private coldFor(dirs: StoreDirs): RecallIndex | undefined {
		const records: MemoryRecord[] = [];
		const stamps: number[] = [];
		for (const [dir, prefix] of [[dirs.project, ""], [dirs.global, "g:"]] as const) {
			if (!dir) continue;
			const file = join(dir, "forgotten.jsonl");
			if (!existsSync(file)) continue;
			stamps.push(statSync(file).mtimeMs);
			for (const line of readFileSync(file, "utf8").split("\n")) {
				if (!line.trim()) continue;
				try {
					const record = JSON.parse(line) as MemoryRecord;
					records.push({ ...record, id: prefix + record.id, entities: record.entities ?? [] });
				} catch {
					// A corrupt line must not lose the others.
				}
			}
		}
		if (records.length === 0) return undefined;
		const key = `${dirs.project}|${dirs.global ?? ""}`;
		const stamp = stamps.reduce((sum, value) => sum + value, 0);
		const cached = this.cold.get(key);
		if (cached?.stamp === stamp) return cached.index;
		// Forgotten records keep state "dormant": allowed in here, as a deep search includes everything.
		const index = new RecallIndex(records.map((record) => ({ ...record, state: undefined })));
		this.cold.set(key, { stamp, index });
		return index;
	}

	private merged = new Map<string, { key: string; index: RecallIndex; vectors: Map<string, Float32Array> }>();

	/**
	 * The index over all stores (project + global) and the vectors of the given model, built once and reused until a
	 * store changes: rebuilding them per request cost seconds at 100k memories.
	 */
	indexFor(dirs: StoreDirs, model?: string): { index: RecallIndex; vectors: Map<string, Float32Array> } {
		const parts = this.all(dirs);
		const slot = `${dirs.project}|${dirs.global ?? ""}|${model ?? ""}`;
		const key = parts.map((part) => part.stamp).join("|");
		const cached = this.merged.get(slot);
		if (cached?.key === key) return cached;
		const vectors = new Map<string, Float32Array>();
		for (const part of parts) if (model && part.model === model) for (const [id, vector] of part.vectors) vectors.set(id, vector);
		const index = parts.length === 1 ? parts[0].index : new RecallIndex(parts.flatMap((part) => part.records));
		const entry = { key, index, vectors };
		this.merged.set(slot, entry);
		return entry;
	}

	private all(dirs: StoreDirs) {
		const parts = [this.load(dirs.project, "")];
		if (dirs.global) parts.push(this.load(dirs.global, "g:"));
		return parts;
	}

	/**
	 * One memory in full, for the `ricorda` tool: text, state, confirmations, and its neighbours in the graph (explicit
	 * links first, then memories sharing a specific entity). Global ids keep their "g:" prefix.
	 */
	open(dirs: StoreDirs, rawId: string): string {
		const id = rawId.trim().replace(/^#/, "");
		const { index } = this.indexFor(dirs);
		const position = index.positions.get(id);
		if (position === undefined) return `Ricordo ${id} non trovato (forse dimenticato: cercalo con una domanda).`;
		const record = index.records[position];
		const state = record.status === "superseded" ? `superato${record.reason ? `: ${record.reason}` : ""}` : record.state === "dormant" ? "dormiente" : "attivo";
		const head = `#${record.id} [${record.type}] ${record.text} (${state}; conferme ${record.confirmations}, ultima ${record.last})`;
		const neighbours = index
			.neighbors(`m${position}`)
			.map((node) => index.records[Number(node.slice(1))])
			.filter((other) => other.status === "active")
			.slice(0, 6);
		return neighbours.length ? `${head}\nCollegati:\n${neighbours.map((other) => `- #${other.id} [${other.type}] ${other.text}`).join("\n")}` : head;
	}

	/** True when some store already has embeddings (otherwise waiting for the model would bring nothing). */
	hasVectors(dirs: StoreDirs): boolean {
		return this.all(dirs).some((part) => part.vectors.size > 0);
	}

	/**
	 * The always-present part for the system prompt: the project overview /dream writes (gist.md, ≤ 1200 chars) and the
	 * pinned memories not already in it. Stable between two /dream, so the prompt prefix stays cached.
	 */
	core(dirs: StoreDirs): string | undefined {
		const file = join(dirs.project, "gist.md");
		const quadro = existsSync(file) ? readFileSync(file, "utf8").trim().slice(0, 1200) : "";
		const known = quadro.toLowerCase();
		const pinned = coreSection(this.all(dirs).flatMap((part) => part.records).filter((record) => !known.includes(record.text.toLowerCase().replace(/[.\s]+$/, ""))));
		const parts = [quadro ? `Quadro del progetto (da sessioni precedenti):\n${quadro}` : "", pinned ?? ""].filter(Boolean);
		return parts.length ? parts.join("\n\n") : undefined;
	}


	async run(query: string, dirs: StoreDirs, today: string, embedder?: Embedder, options: { includeSuperseded?: boolean; threshold?: number; inquiryThreshold?: number; limit?: number } = {}): Promise<RecallRun> {
		const started = performance.now();
		const ready = isReady(embedder);
		const { index, vectors } = this.indexFor(dirs, embedder?.model);
		const records = index.records;
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
		// Small talk recalls nothing; questions a few cues, tasks more (fixed ceiling).
		const limit = options.limit ?? cueLimit(query);
		if (limit === 0) return { text: "", hits: [], ids: [], chars: 0, estTokens: 0, embedderReady: ready, ms: Math.round((performance.now() - started) * 10) / 10 };
		const { hits } = recall(index, query, { today, vectors, queryVector, semFloor: embedder?.semFloor, semSpan: embedder?.semSpan, includeSuperseded: options.includeSuperseded, threshold: options.threshold, inquiryThreshold: options.inquiryThreshold, limit, exclude: options.includeSuperseded ? undefined : pinned });
		if (options.includeSuperseded) {
			// A deep search also reaches what was forgotten (a person can still recall it when asked on purpose).
			const cold = this.coldFor(dirs);
			if (cold) {
				const coldHits = recall(cold, query, { today, threshold: options.threshold, inquiryThreshold: options.inquiryThreshold, limit, includeSuperseded: true, deep: false }).hits;
				hits.push(...coldHits.map((hit) => ({ ...hit, score: hit.score * 0.9 })));
				hits.sort((a, b) => b.score - a.score);
				hits.splice(limit);
			}
		}
		const text = renderCues(hits, limit);
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
