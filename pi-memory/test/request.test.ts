import assert from "node:assert/strict";
import test from "node:test";
import { classifyRequest, composeRecall, inferScope } from "../src/request.ts";
import { RecallIndex, recall, renderRecall, INQUIRY_THRESHOLD, DEFAULT_THRESHOLD } from "../src/recall.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [], ...extra });

test("classifyRequest: tasks that change code", () => {
	for (const prompt of ["Aggiungi un endpoint per i clienti", "crea la funzione di validazione", "Correggi il bug nel parser", "implementa il login", "sistema il test che fallisce", "Rifattorizza src/utils.ts", "Ora modifica il componente", "scrivi un test per calcolaTotale", "ciao, aggiungi un log nell'handler"]) {
		assert.equal(classifyRequest(prompt), "edit", prompt);
	}
});

test("classifyRequest: questions and explanations never count as edits", () => {
	for (const prompt of ["Come aggiungo un endpoint?", "Cosa fa la funzione calcolaTotale?", "Perché il test fallisce?", "Spiega come funziona il parser, senza modificarlo", "Quante righe ha il file data/clienti.csv?", "Che differenza c'è tra un database relazionale e uno a documenti?", "Cosa significa l'errore TypeError? Non toccare il codice"]) {
		assert.notEqual(classifyRequest(prompt), "edit", prompt);
	}
});

test("classifyRequest: read-only inquiries are flagged", () => {
	for (const prompt of ["Quanti libri del genere giallo ci sono in data/books.csv? Rispondi solo con il numero", "Spiega cosa fa la funzione calcolaTotale in src/utils.ts, senza modificarla", "Che differenza c'è tra un database relazionale e uno a documenti?", "Cosa significa l'errore TypeError: undefined is not a function? Non toccare il codice"]) {
		assert.equal(classifyRequest(prompt), "inquiry", prompt);
	}
});

test("classifyRequest: weak verbs need something code-like, the rest is other", () => {
	assert.equal(classifyRequest("scrivi una poesia sul mare"), "other");
	assert.equal(classifyRequest("che package manager usiamo?"), "other");
	assert.equal(classifyRequest("ok grazie"), "other");
});

test("inferScope: rules that hold for every change are 'sempre'", () => {
	assert.equal(inferScope("correzione", "Messaggi d'errore sempre in italiano."), "sempre");
	assert.equal(inferScope("preferenza", "Ogni funzione esportata ha un JSDoc."), "sempre");
	assert.equal(inferScope("preferenza", "Mai usare console.log."), "sempre");
	assert.equal(inferScope("fatto", "La cache dura sempre 5 minuti."), "contesto");
	assert.equal(inferScope("preferenza", "Il package manager è pnpm."), "contesto");
	assert.equal(inferScope("episodio", "Abbiamo scelto X mai Y."), "contesto");
});

test("composeRecall: 'sempre' first, then relevant, within 5 memories and the character budget", () => {
	const always = ["a1", "a2", "a3", "a4"].map((id, i) => rec(id, `Regola trasversale numero ${i} per ogni modifica.`, { scope: "sempre", confirmations: 4 - i }));
	const hits = ["h1", "h2", "h3", "h4", "h5"].map((id) => ({ record: rec(id, `Fatto pertinente ${id}.`), score: 0.9 }));
	const picked = composeRecall(always, hits);
	assert.ok(picked.length <= 5);
	assert.deepEqual(picked.slice(0, 3).map((hit) => hit.record.id), ["a1", "a2", "a3"]);
	assert.ok(picked.slice(3).every((hit) => hit.record.id.startsWith("h")));
	assert.ok(renderRecall(picked).length <= 1080);
});

test("composeRecall: no duplicates and no 'sempre' without candidates", () => {
	const shared = rec("a1", "Regola.", { scope: "sempre" });
	const picked = composeRecall([shared], [{ record: shared, score: 1 }, { record: rec("h1", "Altro."), score: 0.5 }]);
	assert.deepEqual(picked.map((hit) => hit.record.id), ["a1", "h1"]);
	assert.deepEqual(composeRecall([], []), []);
});

test("recall: an inquiry needs strong evidence, a task does not", () => {
	const index = new RecallIndex([rec("r1", "I file CSV di import usano il punto e virgola.", { entities: ["csv", "import"] })]);
	const weak = "Quante righe ha il file data/clienti.csv?";
	assert.equal(recall(index, weak, { today: "2026-10-06" }).hits.length, 0);
	assert.equal(recall(index, weak, { today: "2026-10-06", inquiryThreshold: 0 }).hits.length, 1);
	assert.equal(recall(index, "leggi il file CSV di import", { today: "2026-10-06" }).hits.length, 1);
	assert.ok(INQUIRY_THRESHOLD > DEFAULT_THRESHOLD);
});
