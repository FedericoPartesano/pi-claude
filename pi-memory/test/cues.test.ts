import { test } from "node:test";
import assert from "node:assert/strict";
import { cueLimit, renderCues, CUES_BUDGET_CHARS, RECALL_HEADER } from "../src/recall.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("cues: up to 12 short lines within the budget, the two strongest in full, each with its #id", () => {
	const hits = Array.from({ length: 15 }, (_, i) => ({ record: rec(`r${i}`, `Ricordo numero ${i} ${"parola ".repeat(20)}`, i === 3 ? { gist: "gist breve del tre" } : {}), score: 1 - i / 100 }));
	const text = renderCues(hits, 12);
	const lines = text.split("\n").slice(1);
	assert.ok(text.startsWith(RECALL_HEADER));
	assert.ok(text.length - RECALL_HEADER.length <= CUES_BUDGET_CHARS, `${text.length}`);
	assert.ok(lines.length >= 6 && lines.length <= 12, `${lines.length}`);
	assert.ok(lines.every((line, i) => line.endsWith(` #r${i}`)));
	assert.ok(lines[0].length > lines[4].length, "the strongest is shown in full");
	assert.ok(lines[3].includes("gist breve del tre"));
	assert.equal(renderCues([], 12), "");
	assert.equal(renderCues(hits, 0), "");
});

test("cueLimit: nothing for small talk, few for questions, more for tasks", () => {
	assert.equal(cueLimit("ciao"), 0);
	assert.equal(cueLimit("ok grazie"), 0);
	assert.equal(cueLimit("asd"), 0);
	assert.equal(cueLimit("spiegami cosa fa il modulo di export"), 6);
	assert.equal(cueLimit("aggiungi la validazione al form ordini in src/orders.ts"), 12);
	assert.equal(cueLimit("come gestiamo le date nel progetto?"), 8);
});
