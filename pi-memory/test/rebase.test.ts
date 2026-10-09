import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseOnCurrent } from "../src/reconcile.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("a /dream result is rebased on what was saved meanwhile: deletions, edits and pins win, other additions are kept", () => {
	const previous = [rec("r1", "Uno"), rec("r2", "Due"), rec("r3", "Tre"), rec("r4", "Quattro")];
	// Saved while the model was thinking: r2 deleted, r3 edited, r4 pinned, r5 added by another session.
	const current = [rec("r1", "Uno"), rec("r3", "Tre corretto"), rec("r4", "Quattro", { pinned: true }), rec("r5", "Da un'altra sessione")];
	// The dream: reinforced r1, touched r2 and r3, added r5 (its own new memory) linked to r1.
	const next = [rec("r1", "Uno", { confirmations: 2 }), rec("r2", "Due ritoccato"), rec("r3", "Tre ritoccato"), rec("r4", "Quattro"), rec("r5", "Nuovo del dream", { links: ["r1"] })];
	const merged = rebaseOnCurrent(previous, current, next);
	const byText = new Map(merged.map((record) => [record.text, record]));
	assert.equal(merged.find((record) => record.id === "r1")?.confirmations, 2, "the dream's reinforcement stays");
	assert.ok(!merged.some((record) => record.id === "r2"), "a deletion is not undone");
	assert.equal(merged.find((record) => record.id === "r3")?.text, "Tre corretto", "the user's edit wins");
	assert.equal(merged.find((record) => record.id === "r4")?.pinned, true, "the pin stays");
	assert.equal(byText.get("Da un'altra sessione")?.id, "r5", "the other session's memory keeps its id");
	const ours = byText.get("Nuovo del dream")!;
	assert.notEqual(ours.id, "r5", "the dream's new memory is renumbered");
	assert.deepEqual(ours.links, ["r1"]);
	assert.equal(new Set(merged.map((record) => record.id)).size, merged.length);
});

test("nothing saved meanwhile: the dream's result as is", () => {
	const previous = [rec("r1", "Uno")];
	const next = [rec("r1", "Uno", { confirmations: 2 }), rec("r2", "Nuovo")];
	assert.deepEqual(rebaseOnCurrent(previous, previous, next), next);
});
