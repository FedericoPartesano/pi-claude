import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTrace } from "../src/trace.ts";

test("trace: every byte written to the terminal lands in the file, sizes and resizes in the .meta file", () => {
	const dir = mkdtempSync(join(tmpdir(), "trace-"));
	const written: string[] = [];
	const stream = Object.assign(new EventEmitter(), { columns: 120, rows: 40, write: (chunk: string | Uint8Array) => (written.push(String(chunk)), true) });
	startTrace(join(dir, "t.bin"), stream as never);
	stream.write("\x1b[2Kciao");
	stream.columns = 100;
	stream.emit("resize");
	stream.write(Buffer.from("è"));
	assert.deepEqual(written, ["\x1b[2Kciao", "è"], "the terminal still gets everything");
	assert.equal(readFileSync(join(dir, "t.bin"), "utf8"), "\x1b[2Kciaoè");
	const meta = readFileSync(join(dir, "t.bin.meta"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(meta, [{ at: 0, cols: 120, rows: 40 }, { at: 8, cols: 100, rows: 40 }]);
});
