import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore, type MemoryRecord } from "../src/store.ts";

const rec = (id: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text: `ricordo ${id}`, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("vectors are saved as one binary file and read back exactly", () => {
	const dir = mkdtempSync(join(tmpdir(), "mem-"));
	const vectors = new Map([["r1", new Float32Array([0.5, -1, 2])], ["r2", new Float32Array([3, 4, 5])]]);
	saveStore(dir, { records: [rec("r1"), rec("r2")], vectors, model: "m" });
	assert.ok(existsSync(join(dir, "vectors.bin")));
	assert.ok(!existsSync(join(dir, "vectors.json")));
	const back = loadStore(dir);
	assert.equal(back.model, "m");
	assert.deepEqual([...back.vectors.get("r2")!], [3, 4, 5]);
	assert.deepEqual([...back.vectors.get("r1")!], [0.5, -1, 2]);
});

test("an old vectors.json is still read, and replaced by the binary file on the next save", () => {
	const dir = mkdtempSync(join(tmpdir(), "mem-"));
	saveStore(dir, { records: [rec("r1")], vectors: new Map(), model: "m" });
	const vector = new Float32Array([1, 2]);
	writeFileSync(join(dir, "vectors.json"), JSON.stringify({ model: "m", vectors: { r1: Buffer.from(vector.buffer).toString("base64") } }));
	const store = loadStore(dir);
	assert.deepEqual([...store.vectors.get("r1")!], [1, 2]);
	saveStore(dir, store);
	assert.ok(!existsSync(join(dir, "vectors.json")));
	assert.deepEqual([...loadStore(dir).vectors.get("r1")!], [1, 2]);
});

test("new optional fields survive a round trip; old records without them load fine", () => {
	const dir = mkdtempSync(join(tmpdir(), "mem-"));
	saveStore(dir, { records: [rec("r1", { gist: "breve", links: ["r2"], state: "dormant", level: "personale", uses: 3, lastUsed: "2026-10-05" }), rec("r2")], vectors: new Map() });
	const [first, second] = loadStore(dir).records;
	assert.equal(first.gist, "breve");
	assert.deepEqual(first.links, ["r2"]);
	assert.equal(first.state, "dormant");
	assert.equal(first.uses, 3);
	assert.equal(second.links, undefined);
});
