import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerPrompt, appendDreamRun, appendRecallEvent, readDreamRuns, readRecallEvents, recallStats, type DreamRun, type RecallEvent, logUsage } from "../src/dashboard-data.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "preferenza", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [], ...extra });
const run = (date: string, added: number): DreamRun => ({ at: `${date}T10:00:00.000Z`, date, scope: "progetto", counts: { added, reinforced: 0, merged: 0, updated: 0, forgotten: 0 }, lines: [`+ [fatto] nuovo ${added}`] });
const event = (at: string, ids: string[]): RecallEvent => ({ at, query: "q", hits: ids.map((id, i) => ({ id, score: 1 - i * 0.1 })), ms: 1 });

test("dream runs: appended, read newest first, corrupt lines skipped", () => {
	const dir = mkdtempSync(join(tmpdir(), "dash-data-"));
	assert.deepEqual(readDreamRuns(dir), []);
	appendDreamRun(dir, run("2026-10-05", 1));
	appendFileSync(join(dir, "dream-log.jsonl"), "{rotto\n");
	appendDreamRun(dir, run("2026-10-07", 3));
	assert.deepEqual(readDreamRuns(dir).map((r) => r.counts.added), [3, 1]);
});

test("recall events: newest first, between max and twice max kept", () => {
	const dir = mkdtempSync(join(tmpdir(), "dash-data-"));
	for (let i = 0; i < 12; i++) appendRecallEvent(dir, event(`2026-10-07T10:00:${String(i).padStart(2, "0")}.000Z`, [`r${i}`]), 5);
	const events = readRecallEvents(dir);
	assert.ok(events.length >= 5 && events.length <= 10, `${events.length}`);
	assert.equal(events[0].hits[0].id, "r11");
	assert.deepEqual(readRecallEvents(join(dir, "nope")), []);
});

test("recallStats: recalls today, total, and the most recalled memories", () => {
	const records = [rec("r1", "uno"), rec("r2", "due"), rec("g:r1", "globale")];
	const events = [event("2026-10-07T09:00:00Z", ["r1", "r2"]), event("2026-10-07T08:00:00Z", ["r1"]), event("2026-10-06T08:00:00Z", ["g:r1", "r1"]), event("2026-10-06T07:00:00Z", ["zz"])];
	const stats = recallStats(events, records, "2026-10-07");
	assert.equal(stats.today, 2);
	assert.equal(stats.total, 4);
	assert.deepEqual(stats.top.map((t) => [t.record.id, t.count]), [["r1", 3], ["r2", 1], ["g:r1", 1]]);
});

test("answerPrompt: the question, every memory with its id, answer only from them and cite them", () => {
	const prompt = answerPrompt("che package manager usiamo?", [{ record: rec("r2", "Il package manager è pnpm.", { type: "fatto" }), score: 0.9 }, { record: rec("r3", "Usavamo npm.", { status: "superseded", reason: "superato da pnpm" }), score: 0.4 }]);
	assert.match(prompt, /che package manager usiamo\?/);
	assert.match(prompt, /\[r2\] \(fatto\) Il package manager è pnpm\./);
	assert.match(prompt, /\[r3\].*superato/);
	assert.match(prompt, /solo/i);
	assert.match(prompt, /\[r12\]/);
	assert.match(answerPrompt("x", []), /nessun ricordo/i);
});

test("logUsage: personal memories recalled in a project are logged in the global store too (else they looked unused)", async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const project = mkdtempSync(join(tmpdir(), "use-"));
	const global = mkdtempSync(join(tmpdir(), "use-"));
	logUsage({ project, global }, { at: "2026-10-09T10:00:00Z", query: "q", hits: [{ id: "r1", score: 1 }, { id: "g:r4", score: 0.9 }], ms: 1 });
	logUsage({ project, global }, { at: "2026-10-09T11:00:00Z", query: "q2", hits: [{ id: "r2", score: 1 }], ms: 1 });
	assert.equal(readRecallEvents(project).length, 2);
	assert.deepEqual(readRecallEvents(global).map((event) => event.hits.map((hit) => hit.id)), [["g:r4"]]);
});

test("the recall log keeps the last events without rewriting the file on every request", async () => {
	const { mkdtempSync, statSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "use-"));
	for (let i = 0; i < 30; i++) appendRecallEvent(dir, { at: `2026-10-09T10:00:${String(i).padStart(2, "0")}Z`, query: `q${i}`, hits: [], ms: 0 }, 10);
	const events = readRecallEvents(dir);
	assert.ok(events.length >= 10 && events.length <= 20, `${events.length}`);
	assert.equal(events[0].query, "q29", "newest first");
	assert.ok(statSync(join(dir, "recall-events.jsonl")).size > 0);
});
