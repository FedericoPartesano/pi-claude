import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerPrompt, appendDreamRun, appendRecallEvent, readDreamRuns, readRecallEvents, recallStats, type DreamRun, type RecallEvent } from "../src/dashboard-data.ts";
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

test("recall events: newest first and capped to the last `max`", () => {
	const dir = mkdtempSync(join(tmpdir(), "dash-data-"));
	for (let i = 0; i < 7; i++) appendRecallEvent(dir, event(`2026-10-07T10:00:0${i}.000Z`, [`r${i}`]), 5);
	const events = readRecallEvents(dir);
	assert.equal(events.length, 5);
	assert.equal(events[0].hits[0].id, "r6");
	assert.equal(readFileSync(join(dir, "recall-events.jsonl"), "utf8").trim().split("\n").length, 5);
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
