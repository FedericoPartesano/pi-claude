import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderAgents, subagentRows, teamRows, type AgentRow } from "../src/agents.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const toolCall = (name: string, args: Record<string, unknown>) => ({ role: "assistant", content: [{ type: "toolCall", name, arguments: args }] });

test("subagent: single, parallel and chain calls become rows; progress says what each one is doing", () => {
	assert.deepEqual(subagentRows({ agent: "scout", task: "Trova i test di cart" }, undefined, undefined, 1000).map((row) => [row.name, row.task, row.state]), [["scout", "Trova i test di cart", "running"]]);
	const partial = { details: { results: [{ agent: "scout", task: "a", exitCode: 0, messages: [toolCall("bash", { command: "npm test" })] }] } };
	const parallel = subagentRows({ tasks: [{ agent: "scout", task: "a" }, { agent: "reviewer", task: "b" }] }, partial, undefined, 1000);
	assert.equal(parallel.length, 2);
	assert.equal(parallel[0].doing, "eseguo i test");
	const chain = subagentRows({ chain: [{ agent: "scout", task: "a" }, { agent: "implementer", task: "b {previous}" }] }, partial, undefined, 1000);
	assert.deepEqual(chain.map((row) => row.state), ["running", "queued"]);
	const finished = subagentRows({ agent: "scout", task: "a" }, partial, { isError: false, at: 5000 }, 1000);
	assert.equal(finished[0].state, "done");
	assert.equal(subagentRows({ agent: "scout", task: "a" }, { details: { results: [{ agent: "scout", task: "a", exitCode: 1, messages: [] }] } }, { isError: true, at: 5000 }, 1000)[0].state, "failed");
});

test("team: progress lines become one row per task with its latest state", () => {
	const rows = teamRows([
		"finestra 5h al 30%: parallelismo 3",
		"▶ t1 implementer (sonnet) · tentativo 1: Implementa cart",
		"▶ t2 scout (haiku) · tentativo 1 · in parallelo: Cerca i test",
		"✓ t1 verificato",
		"✗ t2 verifica fallita: npm test",
		"▶ t2 scout (haiku) · tentativo 2: Cerca i test",
	], 1000);
	assert.deepEqual(rows.map((row) => [row.name, row.task, row.state, row.attempt]), [
		["t1 implementer", "Implementa cart", "done", 1],
		["t2 scout", "Cerca i test", "running", 2],
	]);
});

test("the SUB-AGENTI rows: icon, name, task, time, and what it is doing underneath", () => {
	const rows: AgentRow[] = [
		{ key: "a", name: "t1 implementer", task: "Implementa cart", state: "running", startedAt: 1000, doing: "eseguo i test" },
		{ key: "b", name: "t2 tester", task: "Scrivi i test", state: "queued" },
		{ key: "c", name: "scout", task: "Trova i file", state: "done", startedAt: 1000, endedAt: 4000 },
	];
	const lines = renderAgents(rows, 38, 13_000, 0);
	for (const line of lines) assert.ok(visibleWidth(line) <= 38);
	const text = lines.map(strip).join("\n");
	assert.match(text, /⠋ t1 implementer · 12s/);
	assert.match(text, /Implementa cart/);
	assert.match(text, /▸ eseguo i test/);
	assert.match(text, /○ t2 tester/);
	assert.match(text, /✓ scout · 3s/);
});
