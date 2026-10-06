import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetBlock, clampDelay, decideTick, failureSignature, nextRunAt, parseLoopArgs, renderLoopStatus, renderTickMessage, tailOutput, type LoopState } from "./loop.ts";

const HOUR = 3600;

test("parses interval, prompt and defaults", () => {
	assert.deepEqual(parseLoopArgs("5m controlla la CI", 60), { kind: "start", intervalSeconds: 300, when: undefined, forSeconds: 24 * HOUR, prompt: "controlla la CI" });
	assert.deepEqual(parseLoopArgs("2h riassumi i log", 60), { kind: "start", intervalSeconds: 7200, when: undefined, forSeconds: 24 * HOUR, prompt: "riassumi i log" });
	assert.equal((parseLoopArgs("90s fai x", 60) as { intervalSeconds: number }).intervalSeconds, 90);
});

test("without interval the loop is self-paced", () => {
	assert.deepEqual(parseLoopArgs("guarda se la build è finita", 60), { kind: "start", intervalSeconds: undefined, when: undefined, forSeconds: 24 * HOUR, prompt: "guarda se la build è finita" });
});

test("parses --when with quotes and --for", () => {
	assert.deepEqual(parseLoopArgs(`10m --when "npm test -- --reporter dot" --for 8h controlla i test`, 60), {
		kind: "start",
		intervalSeconds: 600,
		when: "npm test -- --reporter dot",
		forSeconds: 8 * HOUR,
		prompt: "controlla i test",
	});
	assert.equal((parseLoopArgs(`5m --when 'curl -fs localhost:3000/health' controlla`, 60) as { when: string }).when, "curl -fs localhost:3000/health");
});

test("status, stop and errors", () => {
	assert.deepEqual(parseLoopArgs("", 60), { kind: "status" });
	assert.deepEqual(parseLoopArgs("  stop ", 60), { kind: "stop" });
	assert.equal(parseLoopArgs("30s troppo veloce", 60).kind, "error");
	assert.equal(parseLoopArgs("30s ok coi test", 10).kind, "start");
	assert.equal(parseLoopArgs("5m", 60).kind, "error"); // no prompt
	assert.equal(parseLoopArgs(`--when "npm test" controlla`, 60).kind, "error"); // --when needs an interval
	assert.equal(parseLoopArgs(`5m --when "npm test`, 60).kind, "error"); // unbalanced quote
	assert.equal(parseLoopArgs("5m --for boh fai x", 60).kind, "error");
});

test("next run keeps the cadence without catching up", () => {
	assert.equal(nextRunAt(1_000_000, 300, 1_100_000), 1_300_000);
	assert.equal(nextRunAt(1_000_000, 300, 1_400_000), 1_400_000); // late: run now, no burst
});

test("clamps self-paced delays", () => {
	assert.equal(clampDelay(5), 60);
	assert.equal(clampDelay(600), 600);
	assert.equal(clampDelay(99999), 3600);
	assert.equal(clampDelay(Number.NaN), 60);
	assert.equal(clampDelay(5, 10), 10);
});

test("budget blocks on overage or 5h window >= 90%", () => {
	assert.equal(budgetBlock(undefined), undefined);
	assert.equal(budgetBlock({ fiveHourUtilization: 0.5 }), undefined);
	assert.match(budgetBlock({ fiveHourUtilization: 0.93 }) ?? "", /93%/);
	assert.match(budgetBlock({ fiveHourUtilization: 0.1, isUsingOverage: true }) ?? "", /extra usage/);
});

const state = (overrides: Partial<LoopState> = {}): LoopState => ({
	prompt: "x",
	intervalSeconds: 300,
	forSeconds: 24 * HOUR,
	startedAt: 0,
	iteration: 0,
	nextRunAt: 0,
	pending: false,
	...overrides,
});

test("decides each tick", () => {
	assert.deepEqual(decideTick(state(), 1000, { busy: false }), { action: "run" });
	assert.deepEqual(decideTick(state(), 1000, { busy: true }), { action: "wait" });
	assert.deepEqual(decideTick(state({ pending: true }), 1000, { busy: true }), { action: "skip" });
	assert.deepEqual(decideTick(state({ forSeconds: 10 }), 11_000, { busy: false }), { action: "stop", reason: "scaduto dopo 10s" });
	assert.equal(decideTick(state(), 1000, { busy: false, budget: "finestra 5h al 95%" }).action, "stop");
});

test("tick message: plain, self-paced and --when failure", () => {
	assert.equal(renderTickMessage({ prompt: "controlla la CI", iteration: 3, selfPaced: false, date: "2026-10-06" }), "[loop 3] controlla la CI");
	assert.match(renderTickMessage({ prompt: "guarda", iteration: 1, selfPaced: true, date: "2026-10-06" }), /loop_next/);
	const failed = renderTickMessage({ prompt: "controlla i test", iteration: 2, selfPaced: false, date: "2026-10-06", when: { command: "npm test", exitCode: 1, output: "FAIL cart.test.js" } });
	assert.match(failed, /^\[loop 2\] controlla i test/);
	assert.match(failed, /npm test/);
	assert.match(failed, /exit 1/);
	assert.match(failed, /FAIL cart\.test\.js/);
	assert.match(failed, /intents\/2026-10-06-/);
	assert.match(failed, /source: loop/);
	assert.match(failed, /status: draft/);
	assert.match(failed, /non modificare/i);
});

test("keeps the tail of long output", () => {
	const long = Array.from({ length: 200 }, (_, i) => `riga ${i}`).join("\n");
	const tail = tailOutput(long, 40);
	assert.ok(tail.startsWith("…"));
	assert.ok(tail.endsWith("riga 199"));
	assert.ok(!tail.includes("riga 100\n"));
	assert.equal(tailOutput("breve", 40), "breve");
});

test("footer status", () => {
	const at = new Date(2026, 9, 6, 14, 5).getTime();
	assert.equal(renderLoopStatus(state({ iteration: 3, nextRunAt: at })), "loop 5m · giro 3 · prossimo 14:05");
	assert.equal(renderLoopStatus(state({ intervalSeconds: undefined, iteration: 1, nextRunAt: at })), "loop auto · giro 1 · prossimo 14:05");
	assert.equal(renderLoopStatus(state({ iteration: 2, nextRunAt: at, lastOkAt: new Date(2026, 9, 6, 14, 0).getTime() })), "loop 5m · giro 2 · ok 14:00 · prossimo 14:05");
});

test("same failure twice has the same signature (timings ignored), a different one does not", () => {
	const a = failureSignature(1, "✖ total (1.234ms)\nℹ fail 1\nℹ duration_ms 45.67\n12:41:03 run");
	const b = failureSignature(1, "✖ total (0.98ms)\nℹ fail 1\nℹ duration_ms 51.2\n12:41:18 run");
	assert.equal(a, b);
	assert.notEqual(a, failureSignature(1, "✖ total (1.2ms)\nℹ fail 2\nℹ duration_ms 45.67"));
	assert.notEqual(a, failureSignature(2, "✖ total (1.234ms)\nℹ fail 1\nℹ duration_ms 45.67\n12:41:03 run"));
});
