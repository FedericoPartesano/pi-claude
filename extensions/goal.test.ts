import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAfterSettle, parseGoalArgs, renderReminder, renderStartMessage, runCheck, shouldCreateIntent, type GoalState } from "./goal.ts";
import { parseIntent } from "./intent.ts";

test("parses a goal with checks and max", () => {
	assert.deepEqual(parseGoalArgs(`--check "npm test" --check 'node --test a.test.js' --max 5 sistema i test`), {
		action: "start",
		text: "sistema i test",
		checks: ["npm test", "node --test a.test.js"],
		max: 5,
	});
	assert.deepEqual(parseGoalArgs("sistema il bug del carrello"), { action: "start", text: "sistema il bug del carrello", checks: [], max: undefined });
});

test("parses intent references and subcommands", () => {
	assert.deepEqual(parseGoalArgs("@intents/2026-10-06-sconti.md"), { action: "start", intentFile: "intents/2026-10-06-sconti.md", text: "", checks: [], max: undefined });
	assert.deepEqual(parseGoalArgs("--check \"npm test\" @intents/x.md"), { action: "start", intentFile: "intents/x.md", text: "", checks: ["npm test"], max: undefined });
	assert.deepEqual(parseGoalArgs(""), { action: "status" });
	assert.deepEqual(parseGoalArgs("stop"), { action: "stop" });
	assert.deepEqual(parseGoalArgs(" resume "), { action: "resume" });
});

test("rejects malformed arguments", () => {
	assert.equal(parseGoalArgs("--max zero fai x").action, "error");
	assert.equal(parseGoalArgs("--check").action, "error");
	assert.equal(parseGoalArgs("--max 3").action, "error"); // no goal text
});

test("creates an intent only for large or vague goals", () => {
	for (const text of [
		"vorrei aggiungere gli sconti nel carrello con codici promozionali",
		"implementa una funzionalità di esportazione dei report in CSV",
		"aggiungi la validazione del form, poi scrivi i test e infine aggiorna la documentazione",
		"x".repeat(170),
	]) assert.ok(shouldCreateIntent(text), text);
	for (const text of ["sistema i test che falliscono", "rinomina total in sum in cart.js", "fai passare npm test", "correggi il typo nel README"]) {
		assert.ok(!shouldCreateIntent(text), text);
	}
});

const state = (overrides: Partial<GoalState> = {}): GoalState => ({ text: "x", checks: [], max: 20, continuations: 0, idleContinuations: 0, ...overrides });

test("continues while the goal is open", () => {
	assert.deepEqual(decideAfterSettle(state(), { outcome: "completed", toolCalls: 2 }), { action: "continue" });
	assert.deepEqual(decideAfterSettle(state({ idleContinuations: 1 }), { outcome: "completed", toolCalls: 1 }), { action: "continue" });
});

test("pauses on max, idling, abort, error and budget", () => {
	assert.equal(decideAfterSettle(state({ continuations: 20 }), { outcome: "completed", toolCalls: 3 }).action, "pause");
	assert.equal(decideAfterSettle(state({ idleContinuations: 1 }), { outcome: "completed", toolCalls: 0 }).action, "pause");
	assert.equal(decideAfterSettle(state(), { outcome: "aborted", toolCalls: 1 }).action, "pause");
	assert.equal(decideAfterSettle(state(), { outcome: "error", toolCalls: 1 }).action, "pause");
	assert.equal(decideAfterSettle(state(), { outcome: "completed", toolCalls: 1, budgetStop: "finestra 5h al 93%" }).action, "pause");
	// The first turn without tool calls is allowed (e.g. a plan written as text).
	assert.equal(decideAfterSettle(state(), { outcome: "completed", toolCalls: 0 }).action, "continue");
});

const INTENT = parseIntent(`---
status: ready
---
# Sconti nel carrello

## Problema
I clienti non possono usare codici sconto.

## Outcome atteso
- Il carrello accetta un codice
- Il totale mostra lo sconto

## Utenti e sistemi impattati
Clienti, checkout.

## Vincoli
- Non cambiare l'API pubblica

## Domande aperte
- Gli sconti sono cumulabili?

## Verifica
\`\`\`bash
npm test
\`\`\`
`);

test("reminder carries outcomes and constraints of the intent", () => {
	const text = renderReminder(state({ text: "Sconti nel carrello", continuations: 2, intentFile: "intents/a.md" }), INTENT);
	assert.match(text, /goal_done/);
	assert.match(text, /Il totale mostra lo sconto/);
	assert.match(text, /Non cambiare l'API pubblica/);
	assert.match(text, /3\/20/);
	assert.doesNotMatch(renderReminder(state({ text: "sistema i test" })), /Vincoli/);
});

test("start message: checks, open questions, intent creation", () => {
	const withIntent = renderStartMessage(state({ text: "Sconti nel carrello", intentFile: "intents/a.md", checks: ["npm test"] }), { intent: INTENT });
	assert.match(withIntent, /intents\/a\.md/);
	assert.match(withIntent, /cumulabili/); // open questions must be closed first
	assert.match(withIntent, /npm test/);
	const create = renderStartMessage(state({ text: "vorrei gli sconti nel carrello" }), { createIntentAt: "intents/2026-10-06-sconti.md" });
	assert.match(create, /intents\/2026-10-06-sconti\.md/);
	assert.match(create, /in-progress/);
	const plain = renderStartMessage(state({ text: "sistema i test" }), {});
	assert.doesNotMatch(plain, /intents\//);
	assert.match(plain, /goal_done/);
});

test("runCheck reports success, failure and keeps the output tail", async () => {
	assert.deepEqual(await runCheck("true", process.cwd()), { ok: true, output: "" });
	const failed = await runCheck("echo boom >&2; exit 3", process.cwd());
	assert.equal(failed.ok, false);
	assert.match(failed.output, /boom/);
	const long = await runCheck("head -c 10000 /dev/zero | tr '\\0' x; exit 1", process.cwd());
	assert.equal(long.output.length, 4000);
});

test("the chat shows only the goal; the working instructions go to the model hidden", async () => {
	const { startMessages } = await import("./goal.ts");
	const { visible, instructions } = startMessages(state({ text: "analizza i requisiti" }), { createIntentAt: "intents/2026-10-08-analizza.md" });
	assert.equal(visible, "Goal: analizza i requisiti");
	assert.match(instructions, /Prima di iniziare scrivi l'intent intents\/2026-10-08-analizza\.md/);
	assert.match(instructions, /goal_done/);
	assert.doesNotMatch(visible, /goal_done|intent/);
	const withIntent = startMessages(state({ text: "e anche i test", intentFile: "intents/a.md" }), { intent: INTENT });
	assert.match(withIntent.visible, /^Goal: .+\nIndicazioni aggiuntive: e anche i test$/);
	assert.match(withIntent.instructions, /intents\/a\.md/);
});
