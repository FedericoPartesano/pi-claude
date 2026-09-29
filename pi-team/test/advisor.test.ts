import { test } from "node:test";
import assert from "node:assert/strict";
import { adviseTeam, countAreas, countParts } from "../src/advisor.ts";
// @ts-expect-error: plain JS module shared with the evaluation harness
import { cases as compositeCases } from "../../eval/team-cases.mjs";

test("the 6 measured composite jobs → Pi alone (the team did not pay off on them)", () => {
	for (const testCase of compositeCases as { id: string; turns: string[] }[]) {
		const advice = adviseTeam(testCase.turns[0]);
		assert.equal(advice.recommendTeam, false, `${testCase.id}: ${advice.score} ${advice.reasons.join(", ")}`);
	}
});

test("short questions and single edits → Pi alone", () => {
	for (const text of ["Cosa fa totalValue?", "Correggi il refuso in config/settings.json", "Quante righe ERROR ci sono nel log?"]) {
		assert.equal(adviseTeam(text).recommendTeam, false, text);
	}
});

test("large multi-area job → team", () => {
	const text = `Migrazione completa del modulo ordini:
1. riscrivi apps/rca-project/src/orders con il nuovo schema
2. aggiorna apps/sml-fe/app/orders per la nuova API
3. aggiorna libs/sml-baseline/src/orders-dto.ts
4. crea script di migrazione in scripts/migrate-orders.js
5. aggiungi test end-to-end in e2e/orders.spec.ts
6. aggiorna la documentazione in docs/orders.md
Serve una revisione indipendente alla fine.`;
	const advice = adviseTeam(text);
	assert.equal(advice.recommendTeam, true, `${advice.score} ${advice.reasons.join(", ")}`);
});

test("a full context adds weight but does not flip a medium job alone", () => {
	const text = "Aggiungi la validazione in src/config.js, poi aggiorna src/app.js e scrivi i test in test/config.test.js; infine aggiorna docs/config.md";
	assert.equal(adviseTeam(text, 80).score, adviseTeam(text, 20).score + 2);
	assert.equal(adviseTeam(text, 80).recommendTeam, false, "medium job: /compact is enough");
});

test("countParts and countAreas", () => {
	assert.equal(countParts("- a\n- b\n- c"), 3);
	assert.equal(countParts("(1) correggi x (2) aggiungi y"), 2);
	assert.equal(countAreas("apps/a/x.ts apps/a/y.ts apps/b/z.ts libs/c/w.ts README.md"), 4);
});

test("real phrasing: inline numbered list and folder mentions", () => {
	const text = "Migrazione completa: 1. riscrivi src/inventory.js con classi 2. aggiorna src/format.js 3. riscrivi src/csv.js 4. aggiorna src/pagination.js 5. aggiungi test in test/ per ogni modulo 6. aggiorna README.md e docs/NOTE-FORNITORE.md 7. aggiorna scripts/stats.py. Serve una revisione indipendente.";
	assert.equal(countParts(text), 7);
	assert.equal(countAreas(text), 5);
	assert.equal(adviseTeam(text).recommendTeam, true);
	assert.equal(countParts("Versione 2.0 del prodotto"), 1, "a version number is not a list");
});
