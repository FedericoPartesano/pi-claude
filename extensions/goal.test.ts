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

test("goal_done closes only with every expected outcome done and proven; otherwise it says what is missing", async () => {
	const { completionVerdict } = await import("./goal.ts");
	const outcomes = ["codice LIBRI10 applica il 10%", "test verdi", "verifica a mano in Chrome"];
	const ok = completionVerdict(outcomes, [
		{ n: 1, done: true, evidence: "test cart.test.js 'LIBRI10' passa" },
		{ n: 2, done: true, evidence: "npm test: 761 pass, 0 fail" },
		{ n: 3, done: true, evidence: "Chrome DevTools: totale 89,91 € visto in pagina" },
	]);
	assert.deepEqual(ok, { ok: true });
	const partial = completionVerdict(outcomes, [
		{ n: 1, done: true, evidence: "test cart.test.js 'LIBRI10' passa" },
		{ n: 2, done: true, evidence: "npm test: 761 pass, 0 fail" },
		{ n: 3, done: false, evidence: "non fatto" },
	]);
	assert.equal(partial.ok, false);
	assert.match(partial.reason ?? "", /3\. verifica a mano in Chrome/);
	const missing = completionVerdict(outcomes, [{ n: 1, done: true, evidence: "test cart.test.js 'LIBRI10' passa" }]);
	assert.match(missing.reason ?? "", /2\. test verdi/);
	const unproven = completionVerdict(outcomes, outcomes.map((_, i) => ({ n: i + 1, done: true, evidence: "ok" })));
	assert.equal(unproven.ok, false);
	assert.match(unproven.reason ?? "", /prova/);
});

test("without an intent the goal still needs at least one proven point", async () => {
	const { completionVerdict } = await import("./goal.ts");
	assert.equal(completionVerdict([], []).ok, false);
	assert.equal(completionVerdict([], [{ n: 1, done: true, evidence: "file ciao.txt scritto, cat mostra 'ciao'" }]).ok, true);
});

test("progress comes from the intent's checklist: [x] done, [ ] or a plain bullet still to do", async () => {
	const { outcomeMarks } = await import("./goal.ts");
	assert.deepEqual(outcomeMarks(["[x] uno — prova: test ok", "[ ] due", "tre", "[X] quattro"]), [
		{ text: "uno — prova: test ok", done: true },
		{ text: "due", done: false },
		{ text: "tre", done: false },
		{ text: "quattro", done: true },
	]);
});

test("the goal's snapshot and its one-line status for the footer", async () => {
	const { goalSnapshot, statusText } = await import("./goal.ts");
	const running = goalSnapshot(state({ text: "sconti", continuations: 2, max: 20, intentFile: "intents/a.md", startedAt: 0, lastEvent: "chiusura rifiutata: mancano 2" }), ["[x] uno", "[ ] due"], 125_000);
	assert.equal(running.state, "attivo");
	assert.equal(running.done, 1);
	assert.equal(running.total, 2);
	assert.equal(running.minutes, 2);
	assert.equal(statusText(running), "▶ 1/2 · giro 2/20");
	const paused = goalSnapshot(state({ text: "sconti", paused: "serve una decisione", continuations: 4 }), [], 0);
	assert.equal(statusText(paused), "⏸ in pausa · giro 4/20");
	assert.equal(statusText(goalSnapshot(state({ text: "x" }), [], 0)), "▶ giro 0/20");
});

test("chat lines for the goal's moments (shown, never sent to the model)", async () => {
	const { eventLine } = await import("./goal.ts");
	assert.match(eventLine({ kind: "start", text: "sconti nel carrello", intentFile: "intents/a.md", total: 3 }), /▶ Goal avviato: sconti nel carrello · intents\/a\.md · 3 risultati attesi/);
	assert.match(eventLine({ kind: "continue", round: 3, max: 20, done: 1, total: 3, next: "test verdi" }), /↻ Goal · giro 3\/20 · fatti 1\/3 · prossimo: test verdi/);
	assert.match(eventLine({ kind: "rejected", missing: ["2. test verdi", "3. Chrome"] }), /✗ Chiusura rifiutata · mancano: 2\. test verdi, 3\. Chrome/);
	assert.match(eventLine({ kind: "paused", reason: "serve una decisione" }), /⏸ Goal in pausa: serve una decisione · \/goal resume per riprendere/);
	assert.match(eventLine({ kind: "done", total: 3, minutes: 12 }), /✓ Goal completato · 3\/3 risultati · 12 min/);
});

test("a goal with several deliverables gets an intent (its checklist is what goal_done checks)", () => {
	assert.ok(shouldCreateIntent("prepara un piccolo modulo node slugify.js con una funzione slugify, un test che passa con node e un README che spiega come usarla"));
	assert.ok(shouldCreateIntent("aggiungi la validazione e aggiorna il README"));
	assert.ok(!shouldCreateIntent("scrivi ciao.txt con dentro ciao"));
});
