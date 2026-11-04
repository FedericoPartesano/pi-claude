import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import testMonitor from "./test-monitor.ts";
import { estimateTotal, teeBeforeFilter } from "./test-monitor/progress.ts";
import { newTestRun, renderTestMonitor, shownCommand } from "./test-monitor/render.ts";
import { cypressParse, detectRunner, jestParse, nodeParse, playwrightParse, pytestParse, vitestParse } from "./test-monitor/runners.ts";

const visibleWidth = (text: string) => [...text.replace(/\x1b\[[0-9;]*m/g, "")].length;
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("teeBeforeFilter: tee before the first filter, nothing else changes", () => {
	assert.equal(teeBeforeFilter("node --test a.test.ts 2>&1 | tail -12", "/t/x.log"), "node --test a.test.ts 2>&1 | tee '/t/x.log' | tail -12");
	assert.equal(teeBeforeFilter("cd x && npm test 2>&1 | grep -E 'fail|pass' | head", "/t/x.log"), "cd x && npm test 2>&1 | tee '/t/x.log' | grep -E 'fail|pass' | head");
	assert.equal(teeBeforeFilter("npm test", "/t/x.log"), undefined, "no filter: output already streams");
	assert.equal(teeBeforeFilter("npm test | tee out.txt | tail", "/t/x.log"), undefined, "already teed");
	assert.equal(teeBeforeFilter("npm test\nnpm lint | tail", "/t/x.log"), undefined, "multi-line left alone");
	assert.equal(teeBeforeFilter("node --test 'a|b.test.ts' | tail", "/t/x.log"), "node --test 'a|b.test.ts' | tee '/t/x.log' | tail", "pipe in quotes ignored");
});

test("node:test parser: spec and TAP", () => {
	assert.deepEqual(nodeParse("✔ one (1.2ms)\n✖ two (3ms)\n✔ three\nℹ pass 2\nℹ fail 1"), { pass: 2, fail: 1, last: "three", results: ["p", "f", "p"], failed: ["two"] });
	assert.deepEqual(nodeParse("ok 1 - a\nnot ok 2 - b"), { pass: 1, fail: 1, last: "b", results: ["p", "f"], failed: ["b"] });
});

test("node:test parser: the final failing-tests list is not counted again", () => {
	assert.deepEqual(nodeParse("✔ a (1ms)\n✖ b (2ms)\nℹ pass 1\nℹ fail 1\n\n✖ failing tests:\n\n✖ b (2ms)\n  Error: x").results, ["p", "f"]);
});

test("vitest verbose parser: one line per test, skipped ignored, summary list not double counted", () => {
	const text = " ✓ src/w.test.mjs > g > w one 2ms\n × src/w.test.mjs > g > w bad 11ms\n   → expected 1 to be 2\n ↓ src/w.test.mjs > g > w skip\n ✓ src/w.test.mjs > w each 1 0ms\n\n ❯ Failed Tests 1\n FAIL  src/w.test.mjs > g > w bad\n";
	const progress = vitestParse(text);
	assert.deepEqual(progress.results, ["p", "f", "p"]);
	assert.deepEqual(progress.failed, ["src/w.test.mjs > g > w bad"]);
});

test("jest reporter-file parser and pytest -v parser", () => {
	assert.deepEqual(jestParse("@@ok a one\n@@ko a two\n@@ok grp b one").results, ["p", "f", "p"]);
	assert.deepEqual(pytestParse("t.py::test_a PASSED\nt.py::test_b FAILED").failed, ["t.py::test_b"]);
});

test("detectRunner and prepare: vitest gets a verbose reporter, jest a reporter file, user choices are left alone", () => {
	assert.equal(detectRunner("npx vitest run a.test.ts | tail")?.name, "vitest");
	assert.equal(detectRunner("node --test x.test.ts")?.name, "node:test");
	assert.equal(detectRunner("npm test | tail")?.name, "script");
	assert.equal(detectRunner("ls | tail"), undefined);
	const ctx = { log: "/t/log", helper: "/t/h", cwd: tmpdir() };
	assert.equal(detectRunner("npx vitest run a.test.ts")?.prepare?.("npx vitest run a.test.ts", ctx)?.command, "npx vitest run --reporter=verbose a.test.ts");
	assert.equal(detectRunner("vitest --reporter=dot")?.prepare?.("vitest --reporter=dot", ctx), undefined);
	const jest = detectRunner("npx jest src/a.test.js")?.prepare?.("npx jest src/a.test.js", ctx);
	assert.equal(jest?.command, "npx jest src/a.test.js --reporters=default --reporters='/t/h/jest-reporter.cjs'");
	assert.match(jest?.files?.["/t/h/jest-reporter.cjs"] ?? "", /onTestCaseResult/);
	assert.equal(detectRunner("npx jest a.js 2>&1 | tail")?.prepare?.("npx jest a.js 2>&1 | tail", ctx)?.command, "npx jest a.js --reporters=default --reporters='/t/h/jest-reporter.cjs' 2>&1 | tail");
	assert.equal(detectRunner("npx jest --json")?.prepare?.("npx jest --json", ctx), undefined);
});

test("estimateTotal counts tests in the named files, each tables, cd and globs", () => {
	const dir = mkdtempSync(join(tmpdir(), "tm-"));
	writeFileSync(join(dir, "a.test.js"), 'test("a", () => {});\nit.each([1,2,3])("e %i", () => {});\ntest.each([[1,2],[3,4]])("t", () => {});\ndescribe("g", () => {\n  it("b", () => {});\n});\n');
	assert.equal(estimateTotal("npx jest a.test.js | tail", dir), 7);
	assert.equal(estimateTotal("cd sub && node --test a.test.js", join(dir, "..")), undefined);
	assert.equal(estimateTotal("npx jest *.test.js", dir), 7);
	assert.equal(estimateTotal("npm test | tail", dir), undefined);
});




test("shownCommand drops the tee Pi inserted", () => {
	assert.equal(shownCommand("node --test a.test.ts 2>&1 | tee '/tmp/x.log' | tail -5"), "node --test a.test.ts 2>&1 | tail -5");
});

test("monitor while running: three full-width rows, a dot per test, counters, clock, latest name", () => {
	const run = { ...newTestRun("node --test a.test.ts", 0), pass: 3, fail: 1, results: ["p", "p", "f", "p"] as ("p" | "f")[], failed: ["b"], last: "d" };
	for (const width of [40, 80, 140]) {
		const rows = renderTestMonitor(run, width, 12_000, 0);
		assert.equal(rows.length, 3);
		for (const row of rows) assert.equal(visibleWidth(row), width, `@${width}`);
	}
	const text = strip(renderTestMonitor(run, 100, 12_000, 0).join("\n"));
	assert.match(text, /RUNNING/);
	assert.match(text, /●●✖●/);
	assert.match(text, /3 ok · 1 ko/);
	assert.match(text, /12s/);
	assert.match(text, /last d/);
});

test("monitor when done: verdict and failed names, or all passing", () => {
	const bad = strip(renderTestMonitor({ ...newTestRun("x", 0), endedAt: 5000, pass: 1, fail: 2, results: ["p", "f", "f"], failed: ["b", "c"] }, 90, 9000, 0).join("\n"));
	assert.match(bad, /FAILED/);
	assert.match(bad, /✖ b · c/);
	assert.match(bad, /5s/, "clock stops at the end");
	const good = strip(renderTestMonitor({ ...newTestRun("x", 0), endedAt: 2000, pass: 4, results: ["p", "p", "p", "p"] }, 90, 9000, 0).join("\n"));
	assert.match(good, /PASSED/);
	assert.match(good, /all 4 passing/);
});

test("monitor with many tests keeps the last dots and an ellipsis", () => {
	const run = { ...newTestRun("x", 0), pass: 200, results: Array(200).fill("p") as "p"[] };
	const row = strip(renderTestMonitor(run, 50, 1000, 0)[1]);
	assert.ok(row.includes("…"));
	assert.equal(visibleWidth(renderTestMonitor(run, 50, 1000, 0)[1]), 50);
});

test("monitor with a known total: grey dots up front, results turn them green or red, counter n/total", () => {
	const run = { ...newTestRun("x", 0), total: 6, pass: 2, fail: 1, results: ["p", "f", "p"] as ("p" | "f")[], failed: ["b"] };
	const text = strip(renderTestMonitor(run, 80, 1000, 0)[1]);
	assert.match(text, /●✖●●●●/);
	assert.match(text, /3\/6/);
	assert.ok(renderTestMonitor(run, 80, 1000, 0)[1].includes("\x1b[38;2;76;81;99m●"), "grey = faint");
	assert.equal(visibleWidth(renderTestMonitor(run, 80, 1000, 0)[1]), 80);
});

test("monitor with more tests than cells: a cell covers several; the total grows past a low estimate", () => {
	const many = { ...newTestRun("x", 0), total: 200, pass: 100, results: Array(100).fill("p") as "p"[] };
	assert.equal(visibleWidth(renderTestMonitor(many, 50, 1000, 0)[1]), 50);
	const over = { ...newTestRun("x", 0), total: 2, pass: 4, results: Array(4).fill("p") as "p"[] };
	assert.match(strip(renderTestMonitor(over, 80, 1000, 0)[1]), /4\/4/);
});

test("extension: rewrites a filtered test command, follows the run, cleans up", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let widget: any;
	const pi = { on: (name: string, handler: any) => handlers.set(name, handler) } as any;
	testMonitor(pi);
	const ctx = { hasUI: true, cwd: process.cwd(), ui: { theme: { name: "x" }, setWidget: (_k: string, factory: any) => (widget = factory({ requestRender() {} })) } };
	handlers.get("session_start")!({}, ctx);
	const input = { command: "node --test extensions/test-monitor.test.ts 2>&1 | tail -3" };
	handlers.get("tool_call")!({ toolName: "bash", toolCallId: "t1", input }, ctx);
	assert.match(input.command, /\| tee '[^']+' \| tail -3$/);
	const log = /tee '([^']+)'/.exec(input.command)![1];
	writeFileSync(log, "✔ one\n✔ two\n✖ three\n");
	await new Promise((resolve) => setTimeout(resolve, 600));
	const rows = widget.render(100).map(strip).join("\n");
	assert.match(rows, /RUNNING/);
	assert.match(rows, /2 ok · 1 ko/);
	handlers.get("tool_execution_end")!({ toolCallId: "t1", result: { content: [] } }, ctx);
	assert.match(widget.render(100).map(strip).join("\n"), /FAILED/);
	assert.equal(existsSync(log), false, "log removed");
	// Not a test command: untouched.
	const other = { command: "ls | tail -3" };
	handlers.get("tool_call")!({ toolName: "bash", toolCallId: "t2", input: other }, ctx);
	assert.equal(other.command, "ls | tail -3");
	handlers.get("session_shutdown")!({}, ctx);
});

test("extension: jest gets a reporter file whose lines feed the monitor", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let widget: any;
	testMonitor({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	const dir = mkdtempSync(join(tmpdir(), "tm-"));
	const ctx = { hasUI: true, cwd: dir, ui: { theme: { name: "x" }, setWidget: (_k: string, factory: any) => (widget = factory({ requestRender() {} })) } };
	handlers.get("session_start")!({}, ctx);
	const input = { command: "npx jest a.test.js 2>&1 | tail -3" };
	handlers.get("tool_call")!({ toolName: "bash", toolCallId: "j1", input }, ctx);
	const script = /--reporters='([^']+)'/.exec(input.command)![1];
	assert.ok(existsSync(script));
	const log = /LOG = "([^"]+)"/.exec(readFileSync(script, "utf8"))![1];
	writeFileSync(log, "@@ok a\n@@ok b\n");
	await new Promise((resolve) => setTimeout(resolve, 600));
	assert.match(widget.render(100).map(strip).join("\n"), /2 ok/);
	handlers.get("tool_execution_end")!({ toolCallId: "j1", result: { content: [] } }, ctx);
	assert.equal(existsSync(script), false, "helper removed");
	handlers.get("session_shutdown")!({}, ctx);
	assert.deepEqual(readdirSync(tmpdir()).filter((name) => name === `pi-test-monitor-${process.pid}`), []);
});

test("playwright list reporter (real output): pass, fail, skipped ignored; the command gets --reporter=list", () => {
	const text = "\nRunning 4 tests using 1 worker\n\n  ✓  1 a.spec.js:2:1 › uno (12ms)\n  ✓  2 [chromium] › a.spec.js:3:1 › due (3ms)\n  ✘  3 a.spec.js:4:1 › rotto (7ms)\n  -  4 a.spec.js:5:6 › saltato\n";
	const progress = playwrightParse(text);
	assert.deepEqual(progress.results, ["p", "p", "f"]);
	assert.deepEqual(progress.failed, ["a.spec.js:4:1 › rotto"]);
	const runner = detectRunner("npx playwright test a.spec.js | tail -5");
	assert.equal(runner?.name, "playwright");
	assert.equal(runner?.prepare?.("npx playwright test a.spec.js | tail -5", { log: "", helper: "", cwd: tmpdir() })?.command, "npx playwright test --reporter=list a.spec.js | tail -5");
	assert.equal(runner?.prepare?.("npx playwright test --reporter=dot", { log: "", helper: "", cwd: tmpdir() }), undefined);
});

test("cypress spec reporter: a failure is numbered twice (run and detail list) but counted once; the closing banner is not a test", () => {
	const text = "    ✓ adds an item (120ms)\n    1) removes an item\n    ✓ lists items (30ms)\n\n  2 passing (1s)\n  1 failing\n\n  1) cart\n       removes an item:\n     AssertionError: x\n\n✖  1 of 1 failed (100%)\n";
	const progress = cypressParse(text);
	assert.deepEqual(progress.results, ["p", "f", "p"]);
	assert.deepEqual(progress.failed, ["removes an item"]);
	assert.equal(cypressParse("✔  All specs passed!").results.length, 0);
	assert.equal(detectRunner("npx cypress run --spec a.cy.ts")?.name, "cypress");
	assert.equal(detectRunner("npm run e2e | tail")?.name, "script");
});

test("redirectedLog: follows cd, finds the file the test stage writes to, refuses what needs the shell", async () => {
	const { redirectedLog } = await import("./test-monitor/progress.ts");
	const vitest = (stage: string) => /\bvitest\b/.test(stage);
	assert.equal(redirectedLog("cd /w/p/e2e; export A=1; timeout 600 npx vitest run t.ts > /tmp/em.log 2>&1; grep -E 'Tests ' /tmp/em.log", "/x", vitest), "/tmp/em.log");
	assert.equal(redirectedLog("cd e2e && npx vitest run >out.log 2>&1", "/w/p", vitest), "/w/p/e2e/out.log");
	assert.equal(redirectedLog("npx vitest run &> 'a b.log'", "/w", vitest), "/w/a b.log");
	assert.equal(redirectedLog("npx vitest run > /dev/null", "/w", vitest), undefined);
	assert.equal(redirectedLog("npx vitest run > $LOG 2>&1", "/w", vitest), undefined);
	assert.equal(redirectedLog("npx vitest run 2>&1 | tail", "/w", vitest), undefined, "pipes are the tee path");
	assert.equal(redirectedLog("npx vitest run", "/w", vitest), undefined);
});

test("extension: a run redirected to a file is followed from that file, which is never deleted", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let widget: any;
	testMonitor({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	const dir = mkdtempSync(join(tmpdir(), "redir-"));
	const ctx = { hasUI: true, cwd: dir, ui: { theme: { name: "x" }, setWidget: (_k: string, factory: any) => (widget = factory({ requestRender() {} })) } };
	handlers.get("session_start")!({}, ctx);
	const log = join(dir, "run.log");
	const input = { command: `timeout 600 npx vitest run a.e2e.ts > ${log} 2>&1; grep Tests ${log}` };
	handlers.get("tool_call")!({ toolName: "bash", toolCallId: "r1", input }, ctx);
	assert.match(input.command, /vitest run --reporter=verbose a\.e2e\.ts > /);
	writeFileSync(log, " ✓ a.e2e.ts > s > one 3ms\n ✓ a.e2e.ts > s > two 3ms\n × a.e2e.ts > s > three 9ms\n");
	await new Promise((resolve) => setTimeout(resolve, 600));
	assert.match(widget.render(100).map(strip).join("\n"), /2 ok · 1 ko/);
	handlers.get("tool_execution_end")!({ toolCallId: "r1", result: { content: [] } }, ctx);
	assert.equal(existsSync(log), true, "the user's file stays");
	handlers.get("session_shutdown")!({}, ctx);
});
