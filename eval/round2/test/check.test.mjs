import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTask } from "../check.mjs";

// A fake repo: the suite prints results.json; the target test passes only with the restored ("REAL") hidden file and
// the agent's fix ("fixed" in results.json).
const fakeRepo = {
	testCommand: () => "cat results.json",
	parse: (output, dir) => {
		const results = JSON.parse(output);
		const real = readFileSync(join(dir, "test/hidden.test.js"), "utf8").includes("REAL");
		(real && results.fixed ? results.passed : results.failed).push("hidden › anchors");
		return { passed: results.passed, failed: results.failed };
	},
};
const task = { hiddenTests: ["test/hidden.test.js"], targetTests: ["hidden › anchors"], baseline: ["a", "b"] };
const setup = (results) => {
	const dir = mkdtempSync(join(tmpdir(), "check-"));
	mkdirSync(join(dir, "test"));
	writeFileSync(join(dir, "test/hidden.test.js"), "agent's own version");
	writeFileSync(join(dir, "results.json"), JSON.stringify(results));
	return dir;
};
const fixFiles = () => "REAL hidden test";

test("pass when the target tests pass and the baseline still passes; the agent's test file is overwritten", () => {
	const dir = setup({ passed: ["a", "b", "c"], failed: [], fixed: true });
	assert.deepEqual(checkTask(dir, task, fakeRepo, fixFiles), { pass: true, reason: "ok", hiddenFailed: [], regressions: [] });
	assert.equal(readFileSync(join(dir, "test/hidden.test.js"), "utf8"), "REAL hidden test");
});

test("fail on target failures and on regressions, with the reason", () => {
	const hiddenFail = checkTask(setup({ passed: ["a", "b"], failed: [], fixed: false }), task, fakeRepo, fixFiles);
	assert.deepEqual([hiddenFail.pass, hiddenFail.reason, hiddenFail.hiddenFailed], [false, "test nascosti falliti: 1", ["hidden › anchors"]]);
	const regression = checkTask(setup({ passed: ["a"], failed: ["b"], fixed: true }), task, fakeRepo, fixFiles);
	assert.deepEqual([regression.pass, regression.reason, regression.regressions], [false, "regressioni: 1", ["b"]]);
});

test("a broken suite is a failure with a reason, not a crash", () => {
	const broken = { testCommand: () => "exit 3", parse: () => { throw new Error("no report"); } };
	assert.deepEqual(checkTask(setup({}), task, broken, fixFiles), { pass: false, reason: "suite in errore o timeout", hiddenFailed: [], regressions: [] });
});
