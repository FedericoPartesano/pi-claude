import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/graph.ts";
import { RecallIndex, recall } from "../src/recall.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 2, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [], ...extra });

test("graph: explicit links work both ways, entities connect memories, unknown ids are ignored", () => {
	const graph = buildGraph([rec("a", "x", { links: ["b", "zz"], entities: ["src/api.ts"] }), rec("b", "y"), rec("c", "z", { entities: ["src/api.ts"] })]);
	assert.deepEqual(graph.links("a"), ["b"]);
	assert.deepEqual(graph.links("b"), ["a"]);
	assert.deepEqual(graph.byEntity("src/api.ts").sort(), ["a", "c"]);
	assert.deepEqual(graph.neighbors("a").sort(), ["b", "c"]);
	assert.deepEqual(graph.neighbors("missing"), []);
});

test("recall follows a link: the reason behind a decision comes along even without shared words", () => {
	const records = [
		rec("d", "Le esportazioni Excel usano exceljs in streaming", { links: ["e"], entities: ["exceljs"] }),
		rec("e", "Il vecchio approccio saturava la RAM del pod con file da 200MB", { type: "episodio" }),
		rec("n", "Le date si formattano con dayjs"),
	];
	const ids = recall(new RecallIndex(records), "come facciamo le esportazioni excel?", { today: "2026-10-08" }).hits.map((hit) => hit.record.id);
	assert.ok(ids.includes("d"));
	assert.ok(ids.includes("e"), `linked memory missing: ${ids}`);
	assert.ok(!ids.includes("n"));
});

test("recall never pulls in a dormant memory through a link", () => {
	const records = [rec("d", "Le esportazioni Excel usano exceljs", { links: ["e"] }), rec("e", "dettaglio vecchio", { state: "dormant" })];
	const ids = recall(new RecallIndex(records), "esportazioni excel", { today: "2026-10-08" }).hits.map((hit) => hit.record.id);
	assert.deepEqual(ids, ["d"]);
});
