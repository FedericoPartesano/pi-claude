import { test } from "node:test";
import assert from "node:assert/strict";
import { entriesToRecords, recordsToEntries } from "../src/reconcile.ts";
import type { MemoryRecord } from "../src/store.ts";

test("a /dream round trip keeps links, gist, dormancy, level and usage of untouched memories", () => {
	const record: MemoryRecord = { id: "r1", type: "fatto", text: "Le esportazioni usano exceljs", pinned: false, confirmations: 2, created: "2026-01-01", last: "2026-05-01", status: "active", entities: ["exceljs"], links: ["r2"], gist: "export: exceljs", state: "dormant", dormantSince: "2026-09-01", level: "progetto", uses: 3, lastUsed: "2026-08-01" };
	const other: MemoryRecord = { id: "r2", type: "fatto", text: "Il pod ha 512MB", pinned: false, confirmations: 1, created: "2026-01-01", last: "2026-05-01", status: "active", entities: [] };
	const { memory, archive } = recordsToEntries([record, other]);
	const [back] = entriesToRecords(memory, archive, [record, other], "2026-10-09");
	assert.deepEqual(back.links, ["r2"]);
	assert.equal(back.gist, "export: exceljs");
	assert.equal(back.state, "dormant");
	assert.equal(back.uses, 3);
	assert.equal(back.lastUsed, "2026-08-01");
	assert.equal(back.level, "progetto");
});
