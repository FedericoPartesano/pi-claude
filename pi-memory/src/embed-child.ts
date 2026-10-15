// Child process of pi-memory's embedder (embed-process.ts): the model lives in its own process, so that closing it gives
// ALL its memory back to the system (a worker thread kept ~600 MB of the Pi process after the model was dropped).
import { BackgroundEmbedder, MODELS, type EmbedKind, type LoadProgress } from "./embed.ts";

let embedder: BackgroundEmbedder | undefined;
const send = (message: object) => process.send?.(message);

process.on("disconnect", () => process.exit(0));
process.on("message", async (message: { type: string; id?: number; model?: string; texts?: string[]; kind?: EmbedKind }) => {
	if (message.type === "load") {
		embedder = new BackgroundEmbedder(MODELS[message.model!] ?? MODELS.e5, { onProgress: (progress: LoadProgress) => send({ type: "progress", progress }) });
		send({ type: (await embedder.start()) ? "ready" : "failed" });
		return;
	}
	if (message.type === "embed") {
		try {
			send({ type: "result", id: message.id, vectors: await embedder!.embed(message.texts!, message.kind) });
		} catch (error) {
			send({ type: "result", id: message.id, error: String((error as Error)?.message ?? error) });
		}
	}
});
