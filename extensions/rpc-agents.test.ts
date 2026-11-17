import { test } from "node:test";
import assert from "node:assert/strict";
import { subagentRows, teamRows, activeRows, agentLines } from "../prototype/rpc-chat/agents.mjs";

const S = new Proxy({}, { get: () => "" });
const fit = (t: string, w: number) => t.slice(0, w);

test("subagent: chain steps queued/running/done, latest action shown", () => {
	const args = { chain: [{ agent: "scout", task: "trova" }, { agent: "worker", task: "usa {previous}" }] };
	const partial = { details: { results: [{ exitCode: 0 }] } };
	const rows = subagentRows(args, partial, undefined, 0);
	assert.deepEqual(rows.map((r: any) => r.state), ["running", "queued"]);
	const run = subagentRows({ agent: "a", task: "t" }, { details: { results: [{ messages: [{ content: [{ type: "toolCall", name: "read", arguments: { path: "x.ts" } }] }] }] } }, undefined, 5);
	assert.equal(run[0].doing, "legge x.ts");
	assert.equal(subagentRows({ agent: "a", task: "t" }, undefined, { isError: true, at: 9 }, 5)[0].state, "failed");
});

test("team rows from progress lines", () => {
	const t = "▶ a1 dev (sonnet) · tentativo 2: scrivi\n▶ b2 rev (sonnet) · tentativo 1: rivedi\n✓ b2 ok";
	const rows = teamRows(t, 100);
	assert.deepEqual(rows.map((r: any) => [r.name, r.state, r.attempt]), [["a1 dev", "running", 2], ["b2 rev", "done", 1]]);
});

test("activeRows drops calls finished long ago; lines fit and are empty with no agents", () => {
	const calls = new Map([
		["1", { tool: "subagent", args: { agent: "a", task: "t" }, startedAt: 0, finished: { isError: false, at: 1000 } }],
		["2", { tool: "subagent", args: { agent: "b", task: "u" }, startedAt: 0 }],
	]);
	assert.deepEqual(activeRows(calls, 50000).map((r: any) => r.name), ["b"]);
	assert.equal(activeRows(calls, 2000).length, 2);
	assert.deepEqual(agentLines([], 20, 0, S, fit), []);
	assert.ok(agentLines(activeRows(calls, 2000), 12, 3000, S, fit).every((l: string) => l.length <= 12 + 8));
});
