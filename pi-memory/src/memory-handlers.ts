/**
 * The memory work behind MemoryWorker: embedding model + Recaller (index, recall, core, vectors). Runs in the worker
 * thread (memory-worker.ts) or, if a worker cannot start, in the caller's thread: same code either way.
 */
import { BackgroundEmbedder, createFakeEmbedder, type EmbedKind, type Embedder, type ModelProfile } from "./embed.ts";
import { Recaller, fillVectors, type StoreDirs } from "./engine.ts";
import type { RecallOptions } from "./recall.ts";

export interface HandlerOptions {
	profile: ModelProfile;
	/** Tests: a hashing embedder instead of the model. */
	fake?: boolean;
}

export type RunOptions = Pick<RecallOptions, "includeSuperseded" | "threshold" | "inquiryThreshold" | "limit"> & {
	/** Wait up to this long for the model before recalling (print mode, where nobody waits for a background load). */
	waitModelMs?: number;
};

export function createHandlers(options: HandlerOptions) {
	const recaller = new Recaller();
	let model: Embedder | undefined;
	let loading: Promise<boolean> | undefined;
	const start = (): Promise<boolean> => {
		if (model) return Promise.resolve(true);
		loading ??= (async () => {
			const candidate: Embedder & { start?: () => Promise<boolean> } = options.fake ? { ...createFakeEmbedder(384), model: options.profile.name } : new BackgroundEmbedder(options.profile);
			const ok = candidate.start ? await candidate.start() : true;
			if (ok) model = candidate;
			loading = undefined;
			return ok;
		})();
		return loading;
	};
	const withModel = async () => {
		if (!model) await start();
		if (!model) throw new Error("embedder not ready");
		return model;
	};
	return {
		start,
		/** Drops the model (hundreds of MB); the index stays, recall goes on with keywords until the next start. */
		unloadModel() {
			model = undefined;
		},
		async embed(texts: string[], kind: EmbedKind) {
			return (await withModel()).embed(texts, kind);
		},
		async recall(query: string, dirs: StoreDirs, today: string, runOptions: RunOptions = {}) {
			if (!model && runOptions.waitModelMs && recaller.hasVectors(dirs)) await Promise.race([start(), new Promise((resolve) => setTimeout(resolve, runOptions.waitModelMs))]);
			return recaller.run(query, dirs, today, model, runOptions);
		},
		async core(dirs: StoreDirs) {
			return recaller.core(dirs);
		},
		async hasVectors(dirs: StoreDirs) {
			return recaller.hasVectors(dirs);
		},
		async fillVectors(dir: string) {
			return fillVectors(dir, await withModel());
		},
		/** Builds the index (and the vector index when the model is loaded) before the first request needs it. */
		async warm(dirs: StoreDirs) {
			const { index, vectors } = recaller.indexFor(dirs, model?.model);
			if (vectors.size > 0) index.vectorsFor(vectors);
			return index.records.length;
		},
	};
}

export type Handlers = ReturnType<typeof createHandlers>;
