import assert from "node:assert/strict";
import { test } from "node:test";
import { addAvoid, AVOID_MAX, isAvoided, similarity } from "../src/avoid.ts";
import { applyAction, parseFixProposal, fixAction, fixPrompt } from "../src/dashboard.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id: "r1", type: "fatto", text: "Usa pnpm", pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("similarity: stesse parole 1, nessuna parola in comune 0, accenti e maiuscole ignorati", () => {
	assert.equal(similarity("Aggiungi il Pulsante di Login", "aggiungi il pulsante di login"), 1);
	assert.equal(similarity("commit del codice", "spiega il lexer"), 0);
	assert.equal(similarity("", "qualcosa"), 0);
	assert.ok(similarity("fai commit e push di tutto", "fai commit e push di oggi") > 0.6);
});

test("isAvoided: solo richieste molto simili a quella segnalata", () => {
	const record = rec({ avoid: ["Committa e pusha il badge dei ricordi"] });
	assert.equal(isAvoided(record, "committa e pusha il badge dei ricordi ora"), true);
	assert.equal(isAvoided(record, "spiega come funziona il lexer di marked"), false);
	assert.equal(isAvoided(rec(), "qualsiasi cosa"), false);
});

test("addAvoid: senza doppioni, con tetto, vuoto ignorato", () => {
	assert.deepEqual(addAvoid(["a b c"], "a b c"), ["a b c"]);
	assert.deepEqual(addAvoid(undefined, "   "), []);
	let list: string[] | undefined;
	for (let i = 0; i < AVOID_MAX + 3; i++) list = addAvoid(list, `richiesta ${i}`);
	assert.equal(list!.length, AVOID_MAX);
	assert.equal(list!.at(-1), `richiesta ${AVOID_MAX + 2}`);
});

test("applyAction avoid aggiunge la richiesta al ricordo e non tocca il resto", () => {
	const next = applyAction([rec(), rec({ id: "r2" })], "r1", { kind: "avoid", query: "fai il commit" });
	assert.deepEqual(next[0].avoid, ["fai il commit"]);
	assert.equal(next[0].status, "active");
	assert.equal(next[1].avoid, undefined);
});

test("parseFixProposal: legge il JSON anche con testo intorno; rifiuta azioni strane, edit senza testo, riassunto vuoto", () => {
	assert.deepEqual(parseFixProposal('Ecco:\n{"summary":"Non c\'entra.","action":"avoid"}'), { summary: "Non c'entra.", action: "avoid" });
	assert.deepEqual(parseFixProposal('{"summary":"Preciso.","action":"edit","text":" Usa pnpm, mai npm. "}'), { summary: "Preciso.", action: "edit", text: "Usa pnpm, mai npm." });
	assert.equal(parseFixProposal('{"summary":"x","action":"edit"}'), undefined);
	assert.equal(parseFixProposal('{"summary":"x","action":"explode"}'), undefined);
	assert.equal(parseFixProposal('{"summary":" ","action":"keep"}'), undefined);
	assert.equal(parseFixProposal("niente json"), undefined);
});

test("fixAction: keep non cambia niente; avoid serve la richiesta; il resto diventa l'azione", () => {
	assert.equal(fixAction({ summary: "s", action: "keep" }, "q"), undefined);
	assert.equal(fixAction({ summary: "s", action: "avoid" }, undefined), undefined);
	assert.deepEqual(fixAction({ summary: "s", action: "avoid" }, "q"), { kind: "avoid", query: "q" });
	assert.deepEqual(fixAction({ summary: "s", action: "edit", text: "t" }, undefined), { kind: "edit", text: "t" });
	assert.deepEqual(fixAction({ summary: "s", action: "delete" }, undefined), { kind: "delete" });
});

test("fixPrompt: ricordo, richiesta, commento e preferenza per l'azione meno distruttiva", () => {
	const text = fixPrompt(rec({ text: "Usa pnpm" }), "installa le dipendenze", "non c'entra col commit");
	for (const part of ["[r1]", "Usa pnpm", "installa le dipendenze", "non c'entra col commit", "meno distruttiva"]) assert.ok(text.includes(part), part);
	assert.match(fixPrompt(rec(), undefined, "boh"), /non nota/);
});
