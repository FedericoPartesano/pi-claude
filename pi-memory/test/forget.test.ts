import { test } from "node:test";
import assert from "node:assert/strict";
import { lifecycle } from "../src/forget.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text: `ricordo ${id}`, pinned: false, confirmations: 1, created: "2026-01-01", last: "2026-01-01", status: "active", entities: [], ...extra });
const today = "2026-10-09";

test("unused for 90 days: dormant; recently confirmed or used: stays active", () => {
	const result = lifecycle([rec("old", { last: "2026-06-01" }), rec("confirmed", { last: "2026-09-20" }), rec("used", { last: "2026-01-01", lastUsed: "2026-10-01" })], today);
	assert.deepEqual(result.dormant, ["old"]);
	assert.equal(result.records.find((record) => record.id === "old")?.state, "dormant");
	assert.equal(result.records.find((record) => record.id === "used")?.state, undefined);
});

test("dormant and unused for 90 more days: forgotten (out of the store, kept aside to restore)", () => {
	const result = lifecycle([rec("sleepy", { state: "dormant", last: "2026-01-01", dormantSince: "2026-06-01" }), rec("recent", { state: "dormant", last: "2026-01-01", dormantSince: "2026-09-01" })], today);
	assert.deepEqual(result.forgotten.map((record) => record.id), ["sleepy"]);
	assert.deepEqual(result.records.map((record) => record.id), ["recent"]);
});

test("never forgotten: pinned memories and corrections confirmed twice", () => {
	const result = lifecycle([rec("pin", { pinned: true, last: "2024-01-01" }), rec("fix", { type: "correzione", confirmations: 2, last: "2024-01-01" })], today);
	assert.deepEqual(result.dormant, []);
	assert.deepEqual(result.forgotten, []);
});

test("a memory whose files are all gone from the project goes dormant at once (the code changed)", () => {
	const exists = (path: string) => path !== "src/legacy/export.ts";
	const result = lifecycle([rec("gone", { last: "2026-10-01", entities: ["src/legacy/export.ts", "export"] }), rec("here", { last: "2026-10-01", entities: ["src/app.ts"] })], today, { fileExists: exists });
	assert.deepEqual(result.dormant, ["gone"]);
});

test("a dormant memory confirmed or used again wakes up", () => {
	const result = lifecycle([rec("back", { state: "dormant", dormantSince: "2026-08-01", lastUsed: "2026-10-05" })], today);
	assert.deepEqual(result.woken, ["back"]);
	assert.equal(result.records[0].state, undefined);
});

test("superseded memories are left alone (history), and nothing changes twice in a day", () => {
	const records = [rec("history", { status: "superseded", last: "2024-01-01" })];
	assert.deepEqual(lifecycle(records, today).records, records);
	const once = lifecycle([rec("old", { last: "2026-06-01" })], today).records;
	assert.deepEqual(lifecycle(once, today).dormant, []);
});
