import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOutcome, failingTests } from "../src/test-output.ts";

const NODE = `✔ formatPrice (1.4ms)\n✖ totalValue multiplies price by quantity (2.146603ms)\nℹ tests 6\nℹ pass 5\nℹ fail 1\n\n✖ failing tests:\n\ntest at test/inventory.test.js:17:1\n✖ totalValue multiplies price by quantity (2.146603ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n  1500 !== 4000\n`;
const JEST = `FAIL src/cart.test.js\n  ● cart › totalValue = price × qty\n\n    expect(received).toBe(expected)\n\n    Expected: 59.8\n    Received: 29.9\n\n      at Object.<anonymous> (src/cart.test.js:12:10)\n\nTests:       1 failed, 12 passed, 13 total\n`;
const PYTEST = `FAILED tests/test_cart.py::test_total - assert 29.9 == 59.8\n==== 1 failed, 12 passed in 0.12s ====\n`;

test("checkOutcome reads pass/fail counts even when the command exits 0 through a pipe", () => {
	assert.deepEqual(checkOutcome(NODE, false), { failed: true, pass: 5, fail: 1 });
	assert.deepEqual(checkOutcome("ℹ tests 6\nℹ pass 6\nℹ fail 0", false), { failed: false, pass: 6, fail: 0 });
	assert.deepEqual(checkOutcome(JEST, false), { failed: true, pass: 12, fail: 1 });
	assert.deepEqual(checkOutcome(PYTEST, false), { failed: true, pass: 12, fail: 1 });
	assert.deepEqual(checkOutcome("tutto ok", false), { failed: false });
	assert.deepEqual(checkOutcome("bash: x: command not found", true), { failed: true });
});

test("failingTests: name · place · received vs expected", () => {
	assert.deepEqual(failingTests(NODE), ["totalValue multiplies price by quantity · test/inventory.test.js:17 · ricevuto 1500, atteso 4000"]);
	assert.deepEqual(failingTests(JEST), ["cart › totalValue = price × qty · src/cart.test.js:12 · ricevuto 29.9, atteso 59.8"]);
	assert.deepEqual(failingTests(PYTEST), ["test_total · tests/test_cart.py · assert 29.9 == 59.8"]);
	assert.deepEqual(failingTests("nessun test qui"), []);
});

const TAIL = `      at Test.run (node:internal/test_runner/test:1258:12)\n      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {\n    generatedMessage: true,\n    code: 'ERR_ASSERTION',\n    actual: 1500,\n    expected: 4000,\n    operator: 'strictEqual',\n  }\n`;

test("a test run cut by tail still counts as failed when the assertion error is visible", () => {
	assert.equal(checkOutcome(TAIL, false, true).failed, true);
	assert.equal(checkOutcome(TAIL, false, false).failed, false, "only for test commands");
	assert.equal(checkOutcome("✔ all good\nℹ pass 3\nℹ fail 0", false, true).failed, false);
	assert.deepEqual(failingTests(TAIL), ["ricevuto 1500, atteso 4000"]);
});
