/**
 * Pi's side of the memory worker: recall, core, vectors and embeddings by message, nothing computed on the UI thread.
 * The model is dropped after `idleMs` without use and reloaded by itself; the index stays warm. If no worker can start,
 * the same handlers run in this thread (like WorkerEmbedder's fallback).
 */
import type { EmbedKind, Embedder, ModelProfile } from "./embed.ts";
import { DEFAULT_MODEL, MODELS } from "./embed.ts";
import type { RecallRun, StoreDirs } from "./engine.ts";
import type { MemoryRecord } from "./store.ts";
import type { EpisodeHit } from "./episodes.ts";
import { createHandlers, type Handlers, type RunOptions } from "./memory-handlers.ts";

type Method = keyof Handlers;

export class MemoryWorker implements Embedder {
	readonly profile: ModelProfile;
	private readonly fake: boolean;
	private readonly idleMs: number;
	private worker: import("node:worker_threads").Worker | undefined;
	private local: Handlers | undefined;
	private booting: Promise<void> | undefined;
	private nextId = 0;
	private readonly pending = new Map<number, { method: Method; args: unknown[]; resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private modelReady = false;
	private loading: Promise<boolean> | undefined;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: { profile?: ModelProfile; fake?: boolean; idleMs?: number } = {}) {
		this.profile = options.profile ?? MODELS[process.env.PI_MEMORY_MODEL ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL];
		this.fake = Boolean(options.fake);
		this.idleMs = options.idleMs ?? Number(process.env.PI_MEMORY_EMBED_IDLE_MS ?? 10 * 60_000);
	}

	get model() {
		return this.profile.name;
	}
	get semFloor() {
		return this.fake ? 0.15 : this.profile.semFloor;
	}
	get semSpan() {
		return this.fake ? 0.85 : this.profile.semSpan;
	}
	/** The embedding model is loaded (recall works without it, on keywords). */
	get ready() {
		return this.modelReady;
	}

	private boot(): Promise<void> {
		this.booting ??= import("node:worker_threads")
			.then(({ Worker }) => {
				const worker = new Worker(new URL("./memory-worker.ts", import.meta.url), { workerData: { profile: this.profile, fake: this.fake } });
				worker.on("message", (message: { id: number; result?: unknown; error?: string }) => {
					const entry = this.pending.get(message.id);
					this.pending.delete(message.id);
					if (this.pending.size === 0) worker.unref();
					if (message.error !== undefined) entry?.reject(new Error(message.error));
					else entry?.resolve(message.result);
				});
				// A worker that dies (an error, or an exit without one): this thread takes over, waiting requests included.
				const takeOver = () => {
					if (this.worker !== worker) return;
					// From now on in this thread; what was waiting for the worker is answered here instead of failing.
					this.worker = undefined;
					void worker.terminate();
					this.local = createHandlers({ profile: this.profile, fake: this.fake });
					this.modelReady = false;
					const waiting = [...this.pending.values()];
					this.pending.clear();
					for (const entry of waiting) {
						Promise.resolve((this.local![entry.method] as (...values: unknown[]) => unknown)(...entry.args)).then(entry.resolve, entry.reject);
					}
				};
				worker.on("error", takeOver);
				worker.on("exit", () => {
					if (this.worker === worker && !this.closing) takeOver();
				});
				// Referenced only while a request waits for its answer: an idle worker must never keep Pi alive (pi -p
				// answered and then hung), a busy one must (or the process exits before the answer). After the listeners:
				// adding a "message" listener refs the worker again.
				worker.unref();
				this.worker = worker;
			})
			.catch(() => {
				this.local = createHandlers({ profile: this.profile, fake: this.fake });
			});
		return this.booting;
	}

	private async call<T>(method: Method, ...args: unknown[]): Promise<T> {
		await this.boot();
		if (this.local || !this.worker) {
			this.local ??= createHandlers({ profile: this.profile, fake: this.fake });
			return (this.local[method] as (...values: unknown[]) => Promise<T>)(...args);
		}
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { method, args, resolve: resolve as (value: unknown) => void, reject });
			this.worker!.ref();
			this.worker!.postMessage({ id, method, args });
		});
	}

	/** Restarts the idle countdown of the model. */
	private touch(): void {
		if (!this.idleMs) return;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			this.modelReady = false;
			void this.call("unloadModel").catch(() => undefined);
		}, this.idleMs);
		this.idleTimer.unref?.();
	}

	start(): Promise<boolean> {
		if (this.modelReady) {
			this.touch();
			return Promise.resolve(true);
		}
		this.loading ??= this.call<boolean>("start")
			.then((ok) => {
				this.modelReady = ok;
				if (ok) this.touch();
				return ok;
			})
			.catch(() => false)
			.finally(() => {
				this.loading = undefined;
			});
		return this.loading;
	}

	async embed(texts: string[], kind: EmbedKind = "passage"): Promise<Float32Array[]> {
		if (!this.modelReady) {
			// Unloaded while idle: reload in the background; callers fall back to keyword recall meanwhile.
			if (!this.loading) void this.start();
			throw new Error("embedder not ready");
		}
		this.touch();
		return this.call<Float32Array[]>("embed", texts, kind);
	}

	recall(query: string, dirs: StoreDirs, today: string, options: RunOptions = {}): Promise<RecallRun> {
		if (this.modelReady) this.touch();
		return this.call<RecallRun>("recall", query, dirs, today, options);
	}

	/** Past sessions: the passages that answer a question (`ricorda` with `episodio`). */
	episodes(files: string[], query: string, today: string): Promise<EpisodeHit[]> {
		return this.call("episodes", files, query, today);
	}

	/** Memories citing a file (the note added when Pi reads or edits it). */
	forFile(dirs: StoreDirs, path: string, today: string): Promise<MemoryRecord[]> {
		return this.call("forFile", dirs, path, today);
	}

	/** One memory in full with its neighbours in the graph (the `ricorda` tool). */
	open(dirs: StoreDirs, id: string): Promise<string> {
		return this.call("open", dirs, id);
	}

	core(dirs: StoreDirs): Promise<string | undefined> {
		return this.call("core", dirs);
	}

	hasVectors(dirs: StoreDirs): Promise<boolean> {
		return this.call("hasVectors", dirs);
	}

	async fillVectors(dir: string): Promise<number> {
		if (!(await this.start())) return 0;
		this.touch();
		return this.call<number>("fillVectors", dir);
	}

	warm(dirs: StoreDirs): Promise<number> {
		return this.call("warm", dirs);
	}

	private closing = false;

	close(): void {
		this.closing = true;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		void this.worker?.terminate();
		this.worker = undefined;
		this.modelReady = false;
	}
}
