import { test } from "node:test";
import assert from "node:assert/strict";
import { adviseWork } from "./work-advisor.ts";
// @ts-expect-error: plain JS module shared with the evaluation harness
import { cases as compositeCases } from "../eval/team-cases.mjs";

const SMALL = [
	"rinomina la funzione total in sum in cart.js",
	"perché fallisce il test di cart.test.js?",
	"correggi il typo in README.md",
	"lancia npm test e dimmi cosa fallisce",
	"come funziona il modulo di autenticazione?",
	"aggiungi un console.log in src/server.ts alla riga 40",
	"spiegami questo errore: TypeError: Cannot read properties of undefined",
	"Cosa fa totalValue?",
	"vorrei capire come funziona il build",
	"voglio sapere quali test sono lenti",
];

const VAGUE_FEATURES = [
	"vorrei aggiungere gli sconti al carrello",
	"voglio che gli utenti possano esportare i report in PDF",
	"dovremmo implementare un sistema di notifiche per gli ordini",
	"mi serve una pagina di amministrazione per gestire gli utenti",
	"aggiungere una funzionalità di ricerca nei prodotti",
	"sarebbe utile avere il login con Google",
];

const LARGE = [
	`Migrazione completa del modulo ordini:
1. riscrivi apps/rca-project/src/orders con il nuovo schema
2. aggiorna apps/sml-fe/app/orders per la nuova API
3. aggiorna libs/sml-baseline/src/orders-dto.ts
4. crea script di migrazione in scripts/migrate-orders.js
5. aggiungi test end-to-end in e2e/orders.spec.ts
6. aggiorna la documentazione in docs/orders.md
Serve una revisione indipendente alla fine.`,
	"Migrazione completa: 1. riscrivi src/inventory.js con classi 2. aggiorna src/format.js 3. riscrivi src/csv.js 4. aggiorna src/pagination.js 5. aggiungi test in test/ per ogni modulo 6. aggiorna README.md e docs/NOTE-FORNITORE.md 7. aggiorna scripts/stats.py. Serve una revisione indipendente.",
	`Vorrei rifare da zero tutta l'app di fatturazione:
- nuovo backend in apps/billing-api
- nuovo frontend in apps/billing-fe
- migrazione dei dati da libs/legacy-billing
- integrazione con il gestionale in libs/erp-client
- test end-to-end in e2e/billing
Serve una revisione indipendente.`,
	`Riscrivi l'intera codebase del modulo magazzino: 1. apps/wms-api 2. apps/wms-fe 3. libs/wms-dto 4. libs/wms-events 5. scripts/wms-migrate 6. docs/wms. Poi test end-to-end in e2e/wms e revisione indipendente.`,
];

const options = { teamAvailable: false, hasActiveIntent: false };

test("small, precise requests and questions → direct", () => {
	for (const text of SMALL) {
		const advice = adviseWork(text, options);
		assert.equal(advice.outcome, "direct", `${text}: ${advice.score} ${advice.reasons.join(", ")}`);
	}
});

// The vague requests of the intent evaluation (eval/intent-cases.mjs): "ask first" took them from 38% to 75%.
const VAGUE_CHANGES = [
	"Vorrei poter applicare gli sconti nel carrello.",
	"Aggiungiamo la ricerca nel catalogo.",
	"Serve un export del report di magazzino.",
	"Lo sconto sugli articoli a volte dà risultati strani, sistemiamolo.",
	"La paginazione va migliorata.",
	"Vorrei che i prezzi si leggessero meglio.",
];

test("vague requests → ask first (light: a hint, no dialog, no file)", () => {
	for (const text of [...VAGUE_FEATURES, ...VAGUE_CHANGES]) {
		const advice = adviseWork(text, options);
		assert.equal(advice.outcome, "ask", `${text}: ${advice.score} ${advice.reasons.join(", ")}`);
	}
});

test("large multi-part jobs → team when available, otherwise intent", () => {
	for (const text of LARGE) {
		assert.equal(adviseWork(text, { ...options, teamAvailable: true }).outcome, "team", text);
		assert.equal(adviseWork(text, options).outcome, "intent", text);
	}
});

test("the measured composite jobs are precise specs → direct", () => {
	for (const testCase of compositeCases as { id: string; turns: string[] }[]) {
		const advice = adviseWork(testCase.turns[0], { ...options, teamAvailable: true });
		assert.equal(advice.outcome, "direct", `${testCase.id}: ${advice.score} ${advice.reasons.join(", ")}`);
	}
});

test("no new intent when one is already in progress or the request cites intents/", () => {
	assert.equal(adviseWork(VAGUE_FEATURES[0], { ...options, hasActiveIntent: true }).outcome, "direct");
	assert.equal(adviseWork("vorrei completare intents/2026-10-06-sconti.md", options).outcome, "direct");
	// A large job still goes to the team even with an active intent.
	assert.equal(adviseWork(LARGE[0], { teamAvailable: true, hasActiveIntent: true }).outcome, "team");
});

test("every advice explains itself", () => {
	const advice = adviseWork(VAGUE_FEATURES[1], options);
	assert.ok(advice.reasons.length > 0);
});
