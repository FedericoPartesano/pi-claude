import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { askable, doubtAction, loadDoubts, mergeDoubts, saveDoubts, type Doubt } from "../src/doubts.ts";
import { buildDreamPrompt, parseProposal } from "../../extensions/memory-core.ts";

const doubt = (id: string, extra: Partial<Doubt> = {}): Doubt => ({ id, question: `domanda ${id}`, at: "2026-10-13T08:00:00Z", ...extra });

test("salva e rilegge; file mancante o rotto = nessun dubbio", () => {
	const dir = mkdtempSync(join(tmpdir(), "doubts-"));
	assert.deepEqual(loadDoubts(dir), []);
	saveDoubts(dir, [doubt("r1", { text: "nuovo" })]);
	assert.deepEqual(loadDoubts(dir), [doubt("r1", { text: "nuovo" })]);
});

test("mergeDoubts: uno per ricordo, vince la domanda nuova", () => {
	const merged = mergeDoubts([doubt("r1"), doubt("r2")], [doubt("r1", { question: "nuova" })]);
	assert.deepEqual(merged.map((item) => item.id + ":" + item.question), ["r2:domanda r2", "r1:nuova"]);
});

test("askable: solo ricordi ancora attivi, al massimo il limite, i più vecchi prima", () => {
	const records = [{ id: "r1", status: "active" as const }, { id: "r2", status: "superseded" as const }, { id: "r3", status: "active" as const }, { id: "r4", status: "active" as const }];
	assert.deepEqual(askable([doubt("r1"), doubt("r2"), doubt("r3"), doubt("r4"), doubt("r9")], records, 2).map((item) => item.id), ["r1", "r3"]);
});

test("doubtAction: con testo modifica, senza testo segna superato", () => {
	assert.deepEqual(doubtAction(doubt("r1", { text: "x" })), { kind: "edit", text: "x" });
	assert.deepEqual(doubtAction(doubt("r1")), { kind: "supersede" });
});

test("parseProposal: legge i dubbi validi (id esistente, domanda non vuota, max 3); PI_DREAM_ASK=0 li ignora", () => {
	const reply = JSON.stringify({ add: [], doubts: [{ id: "m1", question: "Vale ancora?", text: "Nuovo" }, { id: "m9", question: "id sconosciuto" }, { id: "m2", question: " " }, { id: "m2", question: "Ok?" }, { id: "m1", question: "a" }, { id: "m1", question: "b" }] });
	const parsed = parseProposal(reply, 2);
	assert.ok(parsed.ok);
	assert.deepEqual(parsed.proposal.doubts, [{ id: "m1", question: "Vale ancora?", text: "Nuovo" }, { id: "m2", question: "Ok?" }, { id: "m1", question: "a" }]);
	process.env.PI_DREAM_ASK = "0";
	try {
		const off = parseProposal(reply, 2);
		assert.ok(off.ok);
		assert.equal(off.proposal.doubts, undefined);
	} finally {
		delete process.env.PI_DREAM_ASK;
	}
});

test("il prompt di /dream profondo spiega i dubbi; senza deep o con PI_DREAM_ASK=0 no", () => {
	assert.match(buildDreamPrompt([], "x", "2026-10-13", { deep: true }), /"doubts"/);
	assert.doesNotMatch(buildDreamPrompt([], "x", "2026-10-13", {}), /"doubts"/);
	process.env.PI_DREAM_ASK = "0";
	try {
		assert.doesNotMatch(buildDreamPrompt([], "x", "2026-10-13", { deep: true }), /"doubts"/);
	} finally {
		delete process.env.PI_DREAM_ASK;
	}
});
