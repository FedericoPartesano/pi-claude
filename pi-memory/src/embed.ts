/** Local embeddings. The model loads lazily and in the background; a deterministic fake serves tests. */
import { homedir } from "node:os";
import { join } from "node:path";

export type EmbedKind = "query" | "passage";

export interface Embedder {
	embed(texts: string[], kind?: EmbedKind): Promise<Float32Array[]>;
	/** Cosine below this means "unrelated" for this model (cosines of some models are compressed). */
	semFloor?: number;
	/** Cosine range above the floor that maps to full similarity. */
	semSpan?: number;
	model?: string;
}

export interface ModelProfile {
	name: string;
	queryPrefix: string;
	passagePrefix: string;
	semFloor: number;
	semSpan: number;
}

export const MODELS: Record<string, ModelProfile> = {
	e5: { name: "Xenova/multilingual-e5-small", queryPrefix: "query: ", passagePrefix: "passage: ", semFloor: 0.78, semSpan: 0.12 },
	minilm: { name: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", queryPrefix: "", passagePrefix: "", semFloor: 0.35, semSpan: 0.35 },
};
/** e5: the answer two links away stayed at 95% from 1k to 5k memories, minilm fell to 78% (bench/deep-bench.ts). */
export const DEFAULT_MODEL = "e5";

const words = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2);

/** Hashed bag of words, L2-normalized: deterministic, no model, texts sharing words are close. */
export function createFakeEmbedder(dim = 256): Embedder {
	return {
		model: "fake",
		semFloor: 0.15,
		semSpan: 0.85,
		async embed(texts) {
			return texts.map((text) => {
				const vector = new Float32Array(dim);
				for (const word of words(text)) {
					const stem = word.length > 4 ? word.replace(/[aeio]$/, "") : word;
					let hash = 2166136261;
					for (const char of stem) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
					vector[(hash >>> 0) % dim] += 1;
				}
				const norm = Math.hypot(...vector) || 1;
				return vector.map((value) => value / norm);
			});
		},
	};
}

/**
 * Lazy transformers.js embedder: nothing is imported or downloaded until start() (called in the background after
 * session_start). embed() rejects while not ready; callers fall back to lexical recall.
 */
export class BackgroundEmbedder implements Embedder {
	private extractor: ((texts: string[], options: object) => Promise<{ tolist(): number[][] }>) | undefined;
	private loading: Promise<boolean> | undefined;
	readonly profile: ModelProfile;
	constructor(profile: ModelProfile = MODELS[process.env.PI_MEMORY_MODEL ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL]) {
		this.profile = profile;
	}
	get model() {
		return this.profile.name;
	}
	get semFloor() {
		return this.profile.semFloor;
	}
	get semSpan() {
		return this.profile.semSpan;
	}
	get ready() {
		return this.extractor !== undefined;
	}
	/** Resolves true when the model is ready, false on any failure (never throws). */
	start(): Promise<boolean> {
		this.loading ??= (async () => {
			try {
				const { pipeline, env } = await import("@huggingface/transformers");
				env.cacheDir = process.env.PI_MEMORY_MODEL_CACHE ?? join(homedir(), ".cache", "pi-memory", "models");
				this.extractor = (await pipeline("feature-extraction", this.profile.name, { dtype: "q8" })) as never;
				return true;
			} catch {
				return false;
			}
		})();
		return this.loading;
	}
	async embed(texts: string[], kind: EmbedKind = "passage"): Promise<Float32Array[]> {
		if (!this.extractor) throw new Error("embedder not ready");
		const prefix = kind === "query" ? this.profile.queryPrefix : this.profile.passagePrefix;
		const out = await this.extractor(texts.map((text) => prefix + text), { pooling: "mean", normalize: true });
		return out.tolist().map((row) => Float32Array.from(row));
	}
}

/**
 * The embedder in a worker thread: loading the model (hundreds of MB) and computing vectors never touch the main
 * thread. Measured: loading it in the main thread held a keystroke for 2.2 s right after startup. Same interface as
 * BackgroundEmbedder; if the worker cannot start it falls back to one (in-thread).
 */
export class WorkerEmbedder implements Embedder {
	private worker: import("node:worker_threads").Worker | undefined;
	private fallback: BackgroundEmbedder | undefined;
	private loading: Promise<boolean> | undefined;
	private isReady = false;
	private nextId = 0;
	private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>();
	readonly profile: ModelProfile;
	/** Unload the model after this long without use (it holds hundreds of MB); reloaded by itself on the next use. */
	private readonly idleMs: number;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	constructor(profile: ModelProfile = MODELS[process.env.PI_MEMORY_MODEL ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL], options: { idleMs?: number } = {}) {
		this.profile = profile;
		this.idleMs = options.idleMs ?? Number(process.env.PI_MEMORY_EMBED_IDLE_MS ?? 10 * 60_000);
	}
	get model() {
		return this.profile.name;
	}
	get semFloor() {
		return this.profile.semFloor;
	}
	get semSpan() {
		return this.profile.semSpan;
	}
	get ready() {
		return this.isReady || Boolean(this.fallback?.ready);
	}
	/** Restarts the idle countdown; when it runs out the worker (and its memory) goes away. */
	private touch(): void {
		if (this.fallback || !this.idleMs) return;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.unload(), this.idleMs);
		this.idleTimer.unref?.();
	}
	private unload(): void {
		if (this.pending.size) return this.touch();
		void this.worker?.terminate();
		this.worker = undefined;
		this.isReady = false;
		this.loading = undefined;
	}
	start(): Promise<boolean> {
		this.loading ??= new Promise<boolean>((resolve) => {
			const useFallback = () => {
				this.worker = undefined;
				this.fallback ??= new BackgroundEmbedder(this.profile);
				void this.fallback.start().then(resolve);
			};
			import("node:worker_threads")
				.then(({ Worker }) => {
					const worker = new Worker(new URL("./embed-worker.ts", import.meta.url));
					worker.unref();
					this.worker = worker;
					worker.on("message", (message: { type: string; id?: number; vectors?: Float32Array[]; error?: string }) => {
						if (message.type === "ready") {
							this.isReady = true;
							this.touch();
							resolve(true);
						} else if (message.type === "failed") {
							void worker.terminate();
							useFallback();
						} else if (message.type === "result" && message.id !== undefined) {
							const entry = this.pending.get(message.id);
							this.pending.delete(message.id);
							if (message.error) entry?.reject(new Error(message.error));
							else entry?.resolve(message.vectors ?? []);
						}
					});
					worker.on("error", () => {
						for (const entry of this.pending.values()) entry.reject(new Error("embedder worker failed"));
						this.pending.clear();
						if (!this.isReady) useFallback();
						this.isReady = false;
					});
					worker.postMessage({ type: "load", name: this.profile.name, cacheDir: process.env.PI_MEMORY_MODEL_CACHE ?? join(homedir(), ".cache", "pi-memory", "models") });
				})
				.catch(useFallback);
		});
		return this.loading;
	}
	async embed(texts: string[], kind: EmbedKind = "passage"): Promise<Float32Array[]> {
		if (this.fallback) return this.fallback.embed(texts, kind);
		if (!this.worker || !this.isReady) {
			// Unloaded while idle: reload in the background; this call falls back to keyword recall.
			if (!this.loading) void this.start();
			throw new Error("embedder not ready");
		}
		this.touch();
		const prefix = kind === "query" ? this.profile.queryPrefix : this.profile.passagePrefix;
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker!.postMessage({ type: "embed", id, texts: texts.map((text) => prefix + text) });
		});
	}
	close(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		void this.worker?.terminate();
		this.worker = undefined;
		this.isReady = false;
	}
}
