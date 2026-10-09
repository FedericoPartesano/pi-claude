import { test } from "node:test";
import assert from "node:assert/strict";
import { entriesToRecords, movePersonal, recordsToEntries } from "../src/reconcile.ts";
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

test("links, gist and level proposed by /dream reach the saved records", () => {
	const old: MemoryRecord = { id: "r1", type: "fatto", text: "ReportBuilder accoda su reports", pinned: false, confirmations: 1, created: "2026-01-01", last: "2026-05-01", status: "active", entities: [] };
	const entries = [...recordsToEntries([old]).memory, { type: "decisione", text: "La coda reports ha concorrenza 1", pinned: false, confirmations: 1, last: "2026-10-09", links: ["r1"], gist: "reports: concorrenza 1", level: "progetto" as const }];
	const records = entriesToRecords(entries, [], [old], "2026-10-09");
	const added = records.find((record) => record.text.startsWith("La coda"))!;
	assert.deepEqual(added.links, ["r1"]);
	assert.equal(added.gist, "reports: concorrenza 1");
	assert.equal(added.level, "progetto");
});

test("personal memories proposed in a project go to the global store, with ids that do not clash", () => {
	const base = { pinned: false, confirmations: 1, created: "2026-10-09", last: "2026-10-09", status: "active" as const, entities: [] };
	const project: MemoryRecord[] = [{ ...base, id: "r1", type: "fatto", text: "Il deploy usa GitHub Actions" }, { ...base, id: "r2", type: "preferenza", text: "Risposte sempre in italiano", level: "personale" }];
	const global: MemoryRecord[] = [{ ...base, id: "r1", type: "preferenza", text: "Commit in inglese" }];
	const moved = movePersonal(project, global);
	assert.deepEqual(moved.project.map((record) => record.id), ["r1"]);
	assert.deepEqual(moved.global.map((record) => record.text), ["Commit in inglese", "Risposte sempre in italiano"]);
	assert.equal(new Set(moved.global.map((record) => record.id)).size, 2);
	assert.equal(moved.moved, 1);
});
