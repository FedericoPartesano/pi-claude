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
export const DEFAULT_MODEL = "minilm";

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
