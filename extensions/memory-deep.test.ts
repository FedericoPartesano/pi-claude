import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProposal, buildDreamPrompt, parseProposal } from "./memory-core.ts";
import { entriesToRecords, recordsToEntries } from "../pi-memory/src/reconcile.ts";
import type { MemoryRecord } from "../pi-memory/src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("parseProposal keeps entities (bounded, strings only)", () => {
	const parsed = parseProposal('{"add":[{"type":"fatto","text":"x in y","entities":["totalValue","src/a.ts",3,"' + "z".repeat(80) + '"]}],"update":[{"id":"m1","text":"nuovo","entities":["a"]}]}', 1);
	assert.ok(parsed.ok);
	if (parsed.ok) {
		assert.deepEqual(parsed.proposal.add[0].entities, ["totalValue", "src/a.ts"]);
		assert.deepEqual(parsed.proposal.update[0].entities, ["a"]);
	}
});

test("applyProposal carries entities and ids; entries without entities stay unchanged in shape", () => {
	const memory = [{ id: "r1", type: "decisione", text: "Intent in intent/.", pinned: false, confirmations: 2, last: "2026-10-01", entities: ["intent"] }, { type: "fatto", text: "Altro.", pinned: false, confirmations: 1, last: "2026-10-01" }];
	const result = applyProposal(memory, [], { add: [{ type: "fatto", text: "Usa unit_price.", entities: ["unit_price"] }], reinforce: ["m2"], merge: [], update: [{ id: "m1", text: "Intent in docs/intents/.", entities: ["intents"] }], forget: [] }, "2026-10-07");
	assert.equal(result.archive[0].id, "r1");
	assert.deepEqual(result.memory.find((entry) => entry.text.startsWith("Usa"))!.entities, ["unit_price"]);
	assert.deepEqual(result.memory.find((entry) => entry.text.startsWith("Intent"))!.entities, ["intents"]);
	assert.ok(!("entities" in result.memory.find((entry) => entry.text === "Altro.")!));
});

test("deep dream: no cap, the excess stays active; update supersedes; episodes recallable", () => {
	let records: MemoryRecord[] = Array.from({ length: 400 }, (_, i) => rec(`r${i + 1}`, `Ricordo numero ${i + 1} sul modulo ${i % 30}.`));
	const { memory, archive } = recordsToEntries(records);
	const applied = applyProposal(memory, archive, {
		add: [{ type: "episodio", text: "Scelto Postgres perché serve JSONB." }, { type: "fatto", text: "Nuovo fatto sul modulo 7 con totalValue.", entities: ["totalValue"] }],
		reinforce: [], merge: [], update: [{ id: "m1", text: "Ricordo uno aggiornato." }], forget: [],
	}, "2026-10-07");
	records = entriesToRecords(applied.memory, applied.archive, records, "2026-10-07");
	assert.equal(records.filter((r) => r.status === "active").length, 400 - 1 + 1 + 1 + 1); // 399 + updated + episode + new
	assert.equal(records.find((r) => r.id === "r1")!.status, "superseded");
	assert.equal(records.find((r) => r.text.startsWith("Scelto"))!.status, "active");
	assert.ok(records.find((r) => r.text.startsWith("Nuovo fatto"))!.entities.includes("totalvalue"));
});

test("deep dream prompt asks for entities and does not mention the cap", () => {
	const prompt = buildDreamPrompt([], "sessione", "2026-10-07", { deep: true });
	assert.match(prompt, /"entities"/);
	assert.doesNotMatch(prompt, /spazio|tetto/);
});
