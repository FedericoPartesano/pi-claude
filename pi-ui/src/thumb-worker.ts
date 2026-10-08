// Worker thread of pi-ui's thumbnails (src/images.ts): decodes images off the main thread, so the chat never freezes.
import { parentPort } from "node:worker_threads";
import { decodeThumbnail } from "./images.ts";

parentPort?.on("message", ({ id, path, format, size, cols }: { id: number; path: string; format: string; size: number; cols: number }) => {
	parentPort?.postMessage({ id, result: decodeThumbnail(path, format, size, cols) });
});
