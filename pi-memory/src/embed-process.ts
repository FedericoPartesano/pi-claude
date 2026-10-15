/**
 * The embedder in a child process. Same interface as BackgroundEmbedder. Closing it kills the process, so the hundreds
 * of MB of the model really go back to the system (measured: dropping it inside Pi's process freed 37 of ~600 MB).
 */
import { fork, type ChildProcess } from "node:child_process";
import { BackgroundEmbedder, DEFAULT_MODEL, MODELS, type EmbedKind, type Embedder, type LoadProgress, type ModelProfile } from "./embed.ts";

export class ProcessEmbedder implements Embedder {
	readonly profile: ModelProfile;
	private child: ChildProcess | undefined;
	private loading: Promise<boolean> | undefined;
	private isReady = false;
	private nextId = 0;
	private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>();
	private readonly onProgress?: (progress: LoadProgress) => void;
	/** The process cannot start (no .ts support, fork refused): the model loads in this process instead, as before. */
	private fallback: BackgroundEmbedder | undefined;
	private readonly childFile: URL | string;
	constructor(
		profile: ModelProfile = MODELS[process.env.PI_MEMORY_MODEL ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL],
		options: { onProgress?: (progress: LoadProgress) => void; childFile?: URL | string } = {},
	) {
		this.profile = profile;
		this.onProgress = options.onProgress;
		this.childFile = options.childFile ?? new URL("./embed-child.ts", import.meta.url);
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
	/** True when the model runs inside Pi's process because the child could not start. */
	get inProcess(): boolean {
		return this.fallback !== undefined;
	}
	/** Resolves true when the model is ready, false on any failure (never throws). */
	start(): Promise<boolean> {
		if (this.fallback) return this.fallback.start();
		this.loading ??= new Promise<boolean>((resolve) => {
			const wasReady = () => this.isReady;
			const fail = () => {
				const everWorked = wasReady();
				this.isReady = false;
				this.loading = undefined;
				for (const entry of this.pending.values()) entry.reject(new Error("embedder process failed"));
				this.pending.clear();
				// A process that died before it was ready could not run at all: use the in-process model. One that
				// worked and then died is simply started again by the next call.
				if (!everWorked && !this.child) {
					this.fallback = new BackgroundEmbedder(this.profile, { onProgress: this.onProgress });
					void this.fallback.start().then(resolve);
					return;
				}
				resolve(false);
			};
			try {
				const child = fork(this.childFile, { serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] });
				this.child = child;
				child.unref();
				(child.channel as { unref?: () => void } | undefined)?.unref?.();
				child.on("message", (message: { type: string; id?: number; vectors?: Float32Array[]; error?: string; progress?: LoadProgress }) => {
					if (message.type === "progress" && message.progress) this.onProgress?.(message.progress);
					else if (message.type === "ready") {
						this.isReady = true;
						resolve(true);
					} else if (message.type === "failed") {
						// The model itself did not load (network, corrupt cache): the in-process path would fail the same.
						this.close();
						this.isReady = false;
						this.loading = undefined;
						resolve(false);
					} else if (message.type === "result" && message.id !== undefined) {
						const entry = this.pending.get(message.id);
						this.pending.delete(message.id);
						if (message.error) entry?.reject(new Error(message.error));
						else entry?.resolve(message.vectors ?? []);
					}
				});
				child.on("error", () => {
					if (this.child === child) this.child = undefined;
					fail();
				});
				child.on("exit", () => {
					if (this.child === child) {
						this.child = undefined;
						fail();
					}
				});
				child.send({ type: "load", profile: this.profile });
			} catch {
				fail();
			}
		});
		return this.loading;
	}
	async embed(texts: string[], kind: EmbedKind = "passage"): Promise<Float32Array[]> {
		if (this.fallback) return this.fallback.embed(texts, kind);
		if (!this.child || !this.isReady) throw new Error("embedder not ready");
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.child!.send({ type: "embed", id, texts, kind });
		});
	}
	/** Kills the process: its memory goes back to the system. */
	close(): void {
		const child = this.child;
		this.child = undefined;
		this.isReady = false;
		this.loading = undefined;
		child?.kill("SIGKILL");
		this.fallback = undefined; // released for garbage collection; a later start tries the process again
	}
}
