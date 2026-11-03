import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "./test-monitor/render.ts";
import { barCells, newBar, newFeed, newIssues, newSteps, renderView, type ViewState } from "./test-monitor/views.ts";
import { newTestRun } from "./test-monitor/render.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const t0 = 1_000;

function states(): Record<string, ViewState> {
	const bar = { ...newBar("npm run build", t0), done: 34, total: 120, stage: "transform", current: "src/app/page.tsx", warnings: 2 };
	const issues = { ...newIssues("eslint .", t0), files: 40, totalFiles: 90, errors: 1, warnings: 3, issues: [{ level: "warning" as const, file: "a.ts", line: 2, message: "unused", rule: "no-unused-vars" }, { level: "error" as const, file: "src/b.ts", line: 9, message: "Unexpected any", rule: "no-explicit-any" }] };
	const feed = { ...newFeed("npm install", t0), items: 312, added: 280, phase: "fetching", last: "react@19.1.0" };
	const steps = newSteps("npm run ci", t0, ["typecheck", "bundle", "emit"]);
	steps.steps[0].status = "ok";
	steps.steps[1].status = "run";
	return { bar, issues, feed, steps, tests: { kind: "tests", run: { ...newTestRun("node --test", t0), pass: 3, results: ["p", "p", "p"], total: 10 } } };
}

test("every view: three rows, exactly the width, at narrow and wide sizes", () => {
	for (const [name, state] of Object.entries(states())) {
		for (const width of [30, 60, 120]) {
			const rows = renderView(state, width, 6_000, 3);
			assert.equal(rows.length, 3, name);
			for (const row of rows) assert.equal(visibleWidth(row), width, `${name} @${width}`);
		}
	}
});

test("bar: percent and counters while running; verdict when done; indeterminate without a total", () => {
	const { bar } = states() as { bar: Extract<ViewState, { kind: "bar" }> };
	const running = strip(renderView(bar, 100, 6_000, 0).join("\n"));
	assert.match(running, /BUILD RUNNING/);
	assert.match(running, /28%/);
	assert.match(running, /34\/120/);
	assert.match(running, /2 warnings/);
	assert.match(running, /transform src\/app\/page\.tsx/);
	assert.match(strip(renderView({ ...bar, endedAt: 9_000 }, 100, 9_000, 0).join("\n")), /BUILD DONE[\s\S]*finished with 2 warnings/);
	assert.match(strip(renderView({ ...bar, endedAt: 9_000, failed: true, errors: 4 }, 100, 9_000, 0).join("\n")), /BUILD FAILED[\s\S]*4 errors/);
	assert.notEqual(barCells(20, undefined, 0, "#ffffff"), barCells(20, undefined, 5, "#ffffff"));
	assert.equal([...strip(barCells(20, 0.5, 0, "#ffffff"))].filter((c) => c === "█").length, 10);
});

test("issues: counters, files, worst issue first; clean when nothing found", () => {
	const { issues } = states() as { issues: Extract<ViewState, { kind: "issues" }> };
	const text = strip(renderView(issues, 110, 6_000, 0).join("\n"));
	assert.match(text, /1 errors/);
	assert.match(text, /3 warnings/);
	assert.match(text, /40\/90 files/);
	assert.match(text, /✖ src\/b\.ts:9 Unexpected any no-explicit-any/);
	const clean = strip(renderView({ ...newIssues("ruff .", t0), files: 12, endedAt: 3_000 }, 80, 3_000, 0).join("\n"));
	assert.match(clean, /LINT CLEAN[\s\S]*✔ clean/);
	assert.match(strip(renderView({ ...issues, endedAt: 9_000, failed: true }, 110, 9_000, 0).join("\n")), /FOUND ISSUES/);
});

test("feed: phase, counters and the last package; failure shows the message", () => {
	const { feed } = states() as { feed: Extract<ViewState, { kind: "feed" }> };
	const text = strip(renderView(feed, 100, 6_000, 0).join("\n"));
	assert.match(text, /INSTALL RUNNING/);
	assert.match(text, /fetching/);
	assert.match(text, /\+280 · 312 packages/);
	assert.match(text, /last react@19\.1\.0/);
	assert.match(strip(renderView({ ...feed, endedAt: 9_000, failed: true, last: "ERESOLVE unable to resolve" }, 100, 9_000, 0).join("\n")), /✖ ERESOLVE/);
	assert.match(strip(renderView({ ...feed, endedAt: 9_000 }, 100, 9_000, 0).join("\n")), /✔ 312 packages, 280 added/);
});

test("steps: marks per status, progress, and where it failed", () => {
	const { steps } = states() as { steps: Extract<ViewState, { kind: "steps" }> };
	const running = strip(renderView(steps, 100, 6_000, 0).join("\n"));
	assert.match(running, /● typecheck\s+─\s+⠋ bundle\s+─\s+○ emit/);
	assert.match(running, /now bundle · 1\/3/);
	const failed = { ...steps, endedAt: 9_000, failed: true, steps: steps.steps.map((s) => (s.status === "run" ? { ...s, status: "fail" as const } : s)) };
	assert.match(strip(renderView(failed, 100, 9_000, 0).join("\n")), /failed at bundle/);
});

test("tests view delegates to the existing test monitor", () => {
	assert.match(strip(renderView(states().tests, 100, 6_000, 0).join("\n")), /TESTS RUNNING[\s\S]*3 ok/);
});
