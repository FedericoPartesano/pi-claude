import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeIntent, intentPickerItems, intentTemplate, interviewPrompt, parseIntent, renderIntentReminder, setStatus, slugify } from "./intent.ts";

const ITALIAN = `---
status: ready
created: 2026-10-06
source: user
---
# Sconti nel carrello

## Problema
I clienti non possono applicare codici sconto.

## Outcome atteso
- Un codice valido riduce il totale.
- Un codice scaduto mostra un errore.

## Utenti e sistemi impattati
Clienti del sito, modulo cart.

## Vincoli
- Non cambiare l'API pubblica.

## Domande aperte
- Sconti cumulabili?

## Verifica
\`\`\`bash
npm test
node --test test/cart.test.js
\`\`\`
`;

test("parses frontmatter and Italian sections", () => {
	const intent = parseIntent(ITALIAN);
	assert.equal(intent.status, "ready");
	assert.equal(intent.created, "2026-10-06");
	assert.equal(intent.source, "user");
	assert.equal(intent.title, "Sconti nel carrello");
	assert.equal(intent.problem, "I clienti non possono applicare codici sconto.");
	assert.deepEqual(intent.outcomes, ["Un codice valido riduce il totale.", "Un codice scaduto mostra un errore."]);
	assert.equal(intent.users, "Clienti del sito, modulo cart.");
	assert.deepEqual(intent.constraints, ["Non cambiare l'API pubblica."]);
	assert.deepEqual(intent.openQuestions, ["Sconti cumulabili?"]);
	assert.deepEqual(intent.checks, ["npm test", "node --test test/cart.test.js"]);
	assert.deepEqual(intent.missing, []);
});

test("accepts English headings and the playbook title prefix", () => {
	const intent = parseIntent(`# Intent: Claims status

## Problem
Customers phone for status.

## Proposed outcome
- Status visible in the portal.

## Affected users and systems
Customers, claims portal.

## Constraints
- No new PII.

## Open questions
`);
	assert.equal(intent.title, "Claims status");
	assert.deepEqual(intent.outcomes, ["Status visible in the portal."]);
	assert.deepEqual(intent.constraints, ["No new PII."]);
	assert.deepEqual(intent.openQuestions, []);
	assert.deepEqual(intent.missing, []);
});

test("treats 'nessuna' / 'none' as no open questions", () => {
	for (const body of ["- nessuna", "Nessuna.", "- none", "N/A"]) {
		assert.deepEqual(parseIntent(`# T\n\n## Domande aperte\n${body}\n`).openQuestions, [], body);
	}
});

test("without frontmatter: defaults and missing sections", () => {
	const intent = parseIntent("# Solo titolo\n\n## Problema\nQualcosa.\n");
	assert.equal(intent.status, "draft");
	assert.equal(intent.source, "user");
	assert.equal(intent.created, undefined);
	assert.deepEqual(intent.checks, []);
	assert.deepEqual(intent.missing, ["outcome", "users", "constraints"]);
});

test("setStatus rewrites only the status and is idempotent", () => {
	const once = setStatus(ITALIAN, "in-progress");
	assert.equal(parseIntent(once).status, "in-progress");
	assert.equal(setStatus(once, "in-progress"), once);
	assert.equal(once.replace("status: in-progress", "status: ready"), ITALIAN);
});

test("setStatus adds a frontmatter when missing", () => {
	const text = "# T\n\n## Problema\nX.\n";
	const updated = setStatus(text, "done");
	assert.equal(parseIntent(updated).status, "done");
	assert.ok(updated.endsWith(text));
});

test("template parses as a complete draft", () => {
	const intent = parseIntent(intentTemplate("Sconti nel carrello", "2026-10-06"));
	assert.equal(intent.status, "draft");
	assert.equal(intent.created, "2026-10-06");
	assert.equal(intent.title, "Sconti nel carrello");
	assert.deepEqual(intent.missing, []);
});

test("slugify", () => {
	assert.equal(slugify("Aggiungere sconti al carrello!"), "aggiungere-sconti-al-carrello");
	assert.equal(slugify("Perché è così?"), "perche-e-cosi");
	assert.equal(slugify("a".repeat(80)).length, 50);
});

test("activeIntent: newest in-progress intent, or none", () => {
	const cwd = mkdtempSync(join(tmpdir(), "intent-"));
	assert.equal(activeIntent(cwd), undefined, "no intents/ folder");
	mkdirSync(join(cwd, "intents"));
	writeFileSync(join(cwd, "intents", "2026-10-01-vecchio.md"), setStatus(intentTemplate("Vecchio", "2026-10-01"), "in-progress"));
	writeFileSync(join(cwd, "intents", "2026-10-05-nuovo.md"), setStatus(intentTemplate("Nuovo", "2026-10-05"), "in-progress"));
	writeFileSync(join(cwd, "intents", "2026-10-06-bozza.md"), intentTemplate("Bozza", "2026-10-06"));
	const active = activeIntent(cwd);
	assert.equal(active?.intent.title, "Nuovo");
	assert.equal(active?.file, join("intents", "2026-10-05-nuovo.md"));
});

test("renderIntentReminder keeps outcome, constraints and open questions", () => {
	const reminder = renderIntentReminder("intents/2026-10-06-sconti.md", parseIntent(ITALIAN));
	assert.match(reminder, /intents\/2026-10-06-sconti\.md/);
	assert.match(reminder, /Sconti nel carrello/);
	assert.match(reminder, /- Un codice valido riduce il totale\./);
	assert.match(reminder, /- Non cambiare l'API pubblica\./);
	assert.match(reminder, /- Sconti cumulabili\?/);
	assert.match(reminder, /npm test/);
});

test("renderIntentReminder omits empty sections", () => {
	const reminder = renderIntentReminder("intents/x.md", parseIntent("# T\n\n## Outcome atteso\n- A\n\n## Domande aperte\n- nessuna\n"));
	assert.doesNotMatch(reminder, /Domande aperte/);
	assert.doesNotMatch(reminder, /Vincoli/);
});

test("interview asks concrete questions in batches (measured: abstract one-at-a-time questions scored 56% vs 75%)", () => {
	const prompt = interviewPrompt("vorrei gli sconti nel carrello", "2026-10-06");
	assert.match(prompt, /al massimo 3 domande/);
	assert.match(prompt, /nomi di file e funzioni/);
	assert.doesNotMatch(prompt, /Una domanda alla volta/);
	assert.match(prompt, /vorrei gli sconti nel carrello/);
});

test("intent picker items: open work first, done/rejected hidden, preview with outcome and open questions", () => {
	const dir = mkdtempSync(join(tmpdir(), "intent-pick-"));
	mkdirSync(join(dir, "intents"));
	writeFileSync(join(dir, "intents/2026-10-01-old.md"), intentTemplate("Vecchio", "2026-10-01").replace("status: draft", "status: done"));
	writeFileSync(join(dir, "intents/2026-10-02-sconti.md"), "---\nstatus: ready\n---\n# Sconti\n\n## Outcome atteso\n- LIBRI10 = 10%\n\n## Domande aperte\n- cumulabili?\n");
	writeFileSync(join(dir, "intents/2026-10-03-ricerca.md"), "---\nstatus: in-progress\n---\n# Ricerca\n\n## Outcome atteso\n- cerca nel titolo\n");
	const items = intentPickerItems(dir);
	assert.deepEqual(items.map((item) => item.value), ["intents/2026-10-03-ricerca.md", "intents/2026-10-02-sconti.md"]);
	assert.equal(items[0].label, "Ricerca");
	assert.match(items[1].description ?? "", /ready · 1 outcome · 1 domande aperte/);
	assert.match(items[1].preview, /LIBRI10 = 10%[\s\S]*cumulabili\?/);
});
