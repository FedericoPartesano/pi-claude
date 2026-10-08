import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeMemory, summarizeTasks, verdict } from "../analyze.mjs";

const run = (task, harness, attempt, pass) => ({ task, harness, attempt, pass, inputTokens: 100, outputTokens: 10, seconds: 5, requests: 2 });

test("task summary: runs, passes and tasks solved at least once", () => {
	const summary = summarizeTasks([run("a", "pi-full", 1, true), run("a", "pi-full", 2, false), run("b", "pi-full", 1, false), run("b", "pi-full", 2, false), run("a", "claude-code", 1, true)]);
	assert.deepEqual(summary["pi-full"], { runs: 4, passed: 1, solvedTasks: 1, totalTasks: 2, inputTokens: 400, outputTokens: 40, seconds: 20, requests: 8 });
});

test("memory compliance ignores n.a.", () => {
	const summary = summarizeMemory([{ arm: "memory", harness: "pi-full", rules: { R1: "ok", R2: "violated", R3: "na" } }, { arm: "memory", harness: "pi-full", rules: { R1: "ok", R2: "ok" } }]);
	assert.deepEqual(summary["memory|pi-full"], { ok: 3, violated: 1, compliance: 0.75 });
});

test("a difference of 2 tasks or less is a tie", () => {
	assert.equal(verdict(12, 10, 20), "alla pari");
	assert.equal(verdict(14, 10, 20), "più bravo");
	assert.equal(verdict(9, 13, 20), "meno bravo");
});

test("only task × attempt keys both harnesses completed are compared; contaminated runs are left out and counted", async () => {
	const { comparable } = await import("../analyze.mjs");
	const records = [
		run("a", "pi-full", 1, true), run("a", "claude-code", 1, true),
		run("b", "pi-full", 1, true),
		{ ...run("c", "pi-full", 1, true), contaminated: ["gh"] }, run("c", "claude-code", 1, false),
	];
	const { kept, contaminated, unmatched } = comparable(records);
	assert.deepEqual(kept.map((r) => `${r.task}|${r.harness}`), ["a|pi-full", "a|claude-code"]);
	assert.equal(contaminated, 1);
	assert.equal(unmatched, 2, "b has no Claude Code run; c lost its pair");
});

test("memory setup records are not task records", () => {
	const summary = summarizeMemory([{ type: "setup", arm: "memory", harness: "pi-full", corrected: ["R1"] }, { arm: "memory", harness: "pi-full", rules: { R1: "ok" } }]);
	assert.deepEqual(summary["memory|pi-full"], { ok: 1, violated: 0, compliance: 1 });
});
