/**
 * PI_UI_TRACE=<file>: records every byte Pi writes to the terminal (and the sizes, in <file>.meta) to replay a
 * rendering glitch offline in a faithful terminal emulator. Off by default; costs nothing when off.
 */
import { closeSync, openSync, writeSync } from "node:fs";

type Stream = NodeJS.EventEmitter & { columns?: number; rows?: number; write: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean };

export function startTrace(path: string, stream: Stream = process.stdout as unknown as Stream): () => void {
	const data = openSync(path, "w");
	const meta = openSync(`${path}.meta`, "w");
	let offset = 0;
	const size = () => writeSync(meta, `${JSON.stringify({ at: offset, cols: stream.columns, rows: stream.rows })}\n`);
	size();
	stream.on("resize", size);
	const original = stream.write;
	stream.write = function (this: unknown, chunk: string | Uint8Array, ...rest: unknown[]) {
		try {
			const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			writeSync(data, bytes);
			offset += bytes.length;
		} catch {
			// Tracing never breaks the terminal.
		}
		return original.call(this, chunk, ...rest);
	} as Stream["write"];
	return () => {
		stream.write = original;
		stream.off("resize", size);
		closeSync(data);
		closeSync(meta);
	};
}
