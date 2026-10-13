import { test } from "node:test";
import assert from "node:assert/strict";
import { RecallIndex, recall, TOPIC } from "../src/recall.ts";
import { entriesToRecords, recordsToEntries } from "../src/reconcile.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });
const TODAY = "2026-10-13";
const ids = (records: MemoryRecord[], query: string) => recall(new RecallIndex(records), query, { today: TODAY }).hits.map((hit) => hit.record.id);

test("topic: a request naming a topic favours its memories and weighs the other topics down", () => {
	const records = [
		rec("r1", "il timeout di upload è 30 secondi", { topic: "bug server" }),
		rec("r2", "il timeout di upload è 30 secondi", { topic: "pannello" }),
		rec("r3", "il timeout di upload è 30 secondi"),
	];
	const index = new RecallIndex(records);
	const plain = recall(index, "timeout upload", { today: TODAY }).hits;
	const named = recall(index, "timeout upload del bug server", { today: TODAY }).hits;
	const score = (hits: typeof plain, id: string) => hits.find((hit) => hit.record.id === id)?.score ?? 0;
	assert.ok(score(named, "r1") > score(named, "r3"), "same topic first");
	assert.ok(score(named, "r3") > score(named, "r2"), "no topic is neutral, another topic is last");
	assert.ok(Math.abs(score(plain, "r1") - score(plain, "r2")) < 1e-9, "no topic in the request: no effect");
	assert.ok(TOPIC.match > 1 && TOPIC.other < 1);
	assert.deepEqual([...index.topicsIn("che fa il bug server?")], ["bug server"]);
	assert.equal(index.topicsIn("solo il server").size, 0, "all the words of the topic");
	assert.ok(ids(records, "timeout upload").length > 0);
});

test("topic: short words count (\"dev db\" needs both)", () => {
	const index = new RecallIndex([rec("r1", "x", { topic: "dev db" }), rec("r2", "y", { topic: "pannello ui" })]);
	assert.equal(index.topicsIn("censiscila in dev").size, 0);
	assert.deepEqual([...index.topicsIn("copia sul dev db")], ["dev db"]);
	assert.deepEqual([...index.topicsIn("sistema la ui del pannello")], ["pannello ui"]);
});

test("topic: survives consolidation (kept, inherited by a merge, not shown to another entry)", () => {
	const prev = [rec("r1", "uno due tre quattro", { topic: "ricordi" }), rec("r2", "uno due tre cinque")];
	const { memory, archive } = recordsToEntries(prev);
	assert.equal(memory[0].topic, "ricordi");
	const same = entriesToRecords(memory, archive, prev, TODAY);
	assert.equal(same[0].topic, "ricordi");
	const merged = entriesToRecords([{ id: "new:1", type: "fatto", text: "uno due tre", pinned: false, confirmations: 2, last: TODAY, replaces: ["r1", "r2"] }], [], prev, TODAY);
	assert.equal(merged.find((record) => record.status === "active")?.topic, "ricordi");
});
