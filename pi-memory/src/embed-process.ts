/**
 * The embedder in a child process. Same interface as BackgroundEmbedder. Closing it kills the process, so the hundreds
 * of MB of the model really go back to the system (measured: dropping it inside Pi's process freed 37 of ~600 MB).
 */
import { fork, type ChildProcess } from "node:child_process";
import { DEFAULT_MODEL, MODELS, type EmbedKind, type Embedder, type LoadProgress, type ModelProfile } from "./embed.ts";

export class ProcessEmbedder implements Embedder {
	readonly profile: ModelProfile;
	private child: ChildProcess | undefined;
	private loading: Promise<boolean> | undefined;
	private isReady = false;
	private nextId = 0;
	private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>();
	private readonly onProgress?: (progress: LoadProgress) => void;
	constructor(profile: ModelProfile = MODELS[process.env.PI_MEMORY_MODEL ?? DEFAULT_MODEL] ?? MODELS[DEFAULT_MODEL], options: { onProgress?: (progress: LoadProgress) => void } = {}) {
		this.profile = profile;
		this.onProgress = options.onProgress;
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
		return this.isReady;
	}
	private key(): string {
		return Object.entries(MODELS).find(([, profile]) => profile.name === this.profile.name)?.[0] ?? DEFAULT_MODEL;
	}
	/** Resolves true when the model is ready, false on any failure (never throws). */
	start(): Promise<boolean> {
		this.loading ??= new Promise<boolean>((resolve) => {
			const fail = () => {
				this.isReady = false;
				this.loading = undefined;
				for (const entry of this.pending.values()) entry.reject(new Error("embedder process failed"));
				this.pending.clear();
				resolve(false);
			};
			try {
				const child = fork(new URL("./embed-child.ts", import.meta.url), { serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] });
				this.child = child;
				child.unref();
				(child.channel as { unref?: () => void } | undefined)?.unref?.();
				child.on("message", (message: { type: string; id?: number; vectors?: Float32Array[]; error?: string; progress?: LoadProgress }) => {
					if (message.type === "progress" && message.progress) this.onProgress?.(message.progress);
					else if (message.type === "ready") {
						this.isReady = true;
						resolve(true);
					} else if (message.type === "failed") {
						this.close();
						fail();
					} else if (message.type === "result" && message.id !== undefined) {
						const entry = this.pending.get(message.id);
						this.pending.delete(message.id);
						if (message.error) entry?.reject(new Error(message.error));
						else entry?.resolve(message.vectors ?? []);
					}
				});
				child.on("error", fail);
				child.on("exit", () => {
					if (this.child === child) {
						this.child = undefined;
						fail();
					}
				});
				child.send({ type: "load", model: this.key() });
			} catch {
				fail();
			}
		});
		return this.loading;
	}
	async embed(texts: string[], kind: EmbedKind = "passage"): Promise<Float32Array[]> {
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
	}
}
