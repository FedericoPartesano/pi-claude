import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { completeStep, renderTurn, type Step } from "../src/steps.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const done = (tool: string, args: Record<string, unknown>, output: string, extra: Partial<Step> = {}): Step => completeStep({ id: `${tool}${Math.random()}`, tool, args }, { output, isError: false, ...extra });

const read = done("read", { path: "src/cart.js" }, "a\nb\nc");
const edit = done("edit", { path: "src/cart.js" }, "ok", { details: { patch: "@@ -5,1 +5,1 @@\n-a\n+b\n" } });
const tests = done("bash", { command: "npm test" }, "ℹ tests 13\nℹ pass 13\nℹ fail 0");
const failing = done("bash", { command: "npm test 2>&1 | tail -5" }, "✖ totalValue (1ms)\ntest at test/cart.test.js:12:1\n  29.9 !== 59.8\nℹ pass 11\nℹ fail 2");

test("a running turn shows one row per step, the active one highlighted, all at full width", () => {
	const active: Step = { id: "x", tool: "bash", args: { command: "npm test" } };
	for (const width of [40, 80, 120]) {
		const rows = renderTurn([read, edit, active], width, { expanded: false, finished: false, frame: 0 });
		assert.equal(rows.length, 3);
		for (const row of rows) assert.equal(visibleWidth(row), width);
	}
	const wide = renderTurn([read, edit, active], 120, { expanded: false, finished: false, frame: 0 }).map(strip);
	assert.match(wide[0], /✓ Leggo cart.js\s+read\s+src\/cart.js\s+3 righe/);
	assert.match(wide[1], /✓ Modifico cart.js\s+edit\s+src\/cart.js\s+\+1 -1/);
	assert.match(wide[2], /Eseguo i test\s+bash\s+npm test\s+in corso/);
	assert.doesNotMatch(renderTurn([read], 80, { expanded: false, finished: false, frame: 0 }).map(strip)[0], /\bread\b/);
});

test("a finished turn folds into one summary line; ctrl+o reopens it with details", () => {
	const folded = renderTurn([read, edit, tests], 120, { expanded: false, finished: true, frame: 0 }).map(strip);
	assert.deepEqual(folded.length, 1);
	assert.match(folded[0], /✓ 3 passi completati · 1 file · 13 test ok\s+▸ ctrl\+o dettagli/);
	const open = renderTurn([read, edit, tests], 120, { expanded: true, finished: true, frame: 0 }).map(strip);
	assert.ok(open.length > 3);
	assert.ok(open.some((row) => /\+\s+b/.test(row)), "edit diff shown");
});

test("a failure stays open with the failing tests, even when the command hid its exit code", () => {
	assert.equal(failing.error, true);
	const rows = renderTurn([read, failing], 120, { expanded: false, finished: true, frame: 0 }).map(strip);
	assert.match(rows[1], /✗ Eseguo i test.*2 falliti su 13/);
	assert.match(rows[2], /totalValue · test\/cart.test.js:12 · ricevuto 29.9, atteso 59.8/);
});

test("steps of a resumed session are never shown as running", () => {
	const old: Step = { id: "o", tool: "read", args: { path: "a.js" } };
	const rows = renderTurn([old], 80, { expanded: false, finished: true, frame: 0 }).map(strip);
	assert.doesNotMatch(rows.join("\n"), /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
});

test("a test run piped through tail that hides the summary is still a failure", () => {
	const tailed = done("bash", { command: "npm test 2>&1 | tail -20" }, "    code: 'ERR_ASSERTION',\n    actual: 1500,\n    expected: 4000,\n");
	assert.equal(tailed.error, true);
	const rows = renderTurn([tailed], 120, { expanded: false, finished: true, frame: 0 }).map(strip);
	assert.match(rows[0], /✗ Eseguo i test/);
	assert.match(rows[1], /ricevuto 1500, atteso 4000/);
});

test("reading an image is summarised as an image, not as lines", () => {
	assert.equal(done("read", { path: "data/grafico.png" }, "Read image file [image/png]").summary?.text, "immagine");
});

test("a one-step turn (also every step of a resumed session) shows its row, not a '1 passo' summary", () => {
	const rows = renderTurn([read], 120, { expanded: false, finished: true, frame: 0 }).map(strip);
	assert.equal(rows.length, 1);
	assert.match(rows[0], /✓ Leggo cart.js\s+read\s+src\/cart.js\s+3 righe/);
});

const timed = (step: Step, startedAt: number, endedAt?: number): Step => ({ ...step, startedAt, endedAt });

test("a running step shows 'in corso' with its seconds; a finished one its duration (design 04)", () => {
	const running: Step = { id: "r", tool: "bash", args: { command: "npm test" }, startedAt: 1000 };
	const now = 4200;
	assert.match(strip(renderTurn([running], 120, { expanded: false, finished: false, frame: 0, now }).join("\n")), /Eseguo i test\s+bash\s+npm test\s+in corso · 3s/);
	assert.match(strip(renderTurn([timed(tests, 1000, 3100)], 120, { expanded: false, finished: false, frame: 0, now }).join("\n")), /13 pass · 2,1s/);
	assert.doesNotMatch(strip(renderTurn([timed(read, 1000, 1100)], 120, { expanded: false, finished: false, frame: 0, now }).join("\n")), /0,1s/, "quick steps need no duration");
});
