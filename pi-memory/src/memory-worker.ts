// Worker thread of pi-memory (memory-worker-client.ts): the embedding model, the index and recall live here, so Pi's
// interface thread never builds an index, holds vectors or pauses for their garbage collection.
import { parentPort, workerData } from "node:worker_threads";
import { createHandlers, type HandlerOptions } from "./memory-handlers.ts";

const handlers = createHandlers(workerData as HandlerOptions) as unknown as Record<string, (...args: unknown[]) => unknown>;

parentPort?.on("message", async (message: { id: number; method: string; args: unknown[] }) => {
	try {
		const result = await handlers[message.method](...message.args);
		parentPort?.postMessage({ id: message.id, result });
	} catch (error) {
		parentPort?.postMessage({ id: message.id, error: String((error as Error)?.message ?? error) });
	}
});
