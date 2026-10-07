import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsedSeconds, initialStatus, nextStatus, type StatusEvent, type TurnStatus } from "../src/status.ts";

const run = (...events: StatusEvent[]): TurnStatus => events.reduce(nextStatus, initialStatus());

test("a turn goes ready → working → done", () => {
	assert.equal(initialStatus().mode, "ready");
	const working = run({ type: "agent_start", at: 1000 });
	assert.equal(working.mode, "working");
	assert.equal(working.activity, "penso…");
	assert.equal(working.step, 0);
	const done = run({ type: "agent_start", at: 1000 }, { type: "tool_start", activity: "leggo a.js" }, { type: "tool_end", failed: false }, { type: "settled", at: 5000, outcome: "completed" });
	assert.equal(done.mode, "done");
	assert.equal(done.step, 1);
});

test("usage adds up tokens of the turn and a new turn resets them", () => {
	const s = run({ type: "agent_start", at: 0 }, { type: "usage", input: 1000, output: 10 }, { type: "usage", input: 2000, output: 20 });
	assert.deepEqual([s.tokensIn, s.tokensOut], [3000, 30]);
	assert.equal(nextStatus(s, { type: "agent_start", at: 9 }).tokensIn, 0);
});

test("aborted or error turns stop; so does a turn whose last step failed", () => {
	assert.equal(run({ type: "agent_start", at: 0 }, { type: "settled", at: 1, outcome: "aborted" }).mode, "stopped");
	assert.equal(run({ type: "agent_start", at: 0 }, { type: "settled", at: 1, outcome: "aborted" }).activity, "interrotto");
	assert.equal(run({ type: "agent_start", at: 0 }, { type: "settled", at: 1, outcome: "error" }).mode, "stopped");
	const failedLast = run({ type: "agent_start", at: 0 }, { type: "tool_start", activity: "eseguo i test" }, { type: "tool_end", failed: true }, { type: "settled", at: 1, outcome: "completed" });
	assert.equal(failedLast.mode, "stopped");
	assert.match(failedLast.activity, /eseguo i test/);
});

test("a failure fixed by a later step ends done", () => {
	const s = run({ type: "agent_start", at: 0 }, { type: "tool_start", activity: "eseguo i test" }, { type: "tool_end", failed: true }, { type: "tool_start", activity: "modifico a.js" }, { type: "tool_end", failed: false }, { type: "settled", at: 1, outcome: "completed" });
	assert.equal(s.mode, "done");
});

test("the clock stops when the turn ends", () => {
	const working = run({ type: "agent_start", at: 1000 });
	assert.equal(elapsedSeconds(working, 4000), 3);
	const done = nextStatus(working, { type: "settled", at: 6000, outcome: "completed" });
	assert.equal(elapsedSeconds(done, 99_000), 5);
	assert.equal(elapsedSeconds(initialStatus(), 99_000), 0);
});

test("waiting for the user and resuming", () => {
	const waiting = run({ type: "agent_start", at: 0 }, { type: "waiting", question: "posso eseguire npm test?", answers: "s sì · n no" });
	assert.equal(waiting.mode, "waiting");
	assert.equal(waiting.question, "posso eseguire npm test?");
	const resumed = nextStatus(waiting, { type: "resumed" });
	assert.equal(resumed.mode, "working");
	assert.equal(resumed.question, undefined);
});
