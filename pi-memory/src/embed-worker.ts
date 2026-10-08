// Worker thread of pi-memory's embedder (src/embed.ts, WorkerEmbedder): loads the model and computes vectors off the
// main thread, so Pi's interface never waits for it.
import { parentPort } from "node:worker_threads";

let extractor: ((texts: string[], options: object) => Promise<{ tolist(): number[][] }>) | undefined;

parentPort?.on("message", async (message: { type: string; id?: number; name?: string; cacheDir?: string; texts?: string[] }) => {
	if (message.type === "load") {
		try {
			const { pipeline, env } = await import("@huggingface/transformers");
			env.cacheDir = message.cacheDir!;
			extractor = (await pipeline("feature-extraction", message.name!, { dtype: "q8" })) as never;
			parentPort?.postMessage({ type: "ready" });
		} catch {
			parentPort?.postMessage({ type: "failed" });
		}
		return;
	}
	if (message.type === "embed") {
		try {
			const out = await extractor!(message.texts!, { pooling: "mean", normalize: true });
			parentPort?.postMessage({ type: "result", id: message.id, vectors: out.tolist().map((row) => Float32Array.from(row)) });
		} catch (error) {
			parentPort?.postMessage({ type: "result", id: message.id, error: String((error as Error)?.message ?? error) });
		}
	}
});
