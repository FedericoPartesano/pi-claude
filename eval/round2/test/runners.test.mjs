import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJest, parseTap, parseVitest, stablePassing } from "../runners.mjs";

test("jest and vitest JSON: full test names, passed and failed", () => {
	const json = JSON.stringify({ testResults: [{ name: "/r/tests/a.test.ts", assertionResults: [
		{ fullName: "parse handles tabs", status: "passed" },
		{ fullName: "parse handles anchors", status: "failed" },
		{ fullName: "parse skipped", status: "pending" },
	] }] });
	for (const parse of [parseJest, parseVitest]) {
		assert.deepEqual(parse(json, "/r"), { passed: ["tests/a.test.ts › parse handles tabs"], failed: ["tests/a.test.ts › parse handles anchors"] });
	}
});

test("tap: nested subtests joined, todo/skip ignored", () => {
	const tap = ["TAP version 13", "# Subtest: lexer", "    ok 1 - tabs", "    not ok 2 - links", "    ok 3 - wip # SKIP", "ok 1 - lexer", "not ok 2 - parser", ""].join("\n");
	const result = parseTap(tap);
	assert.deepEqual(result.passed, ["lexer › tabs", "lexer"]);
	assert.deepEqual(result.failed, ["lexer › links", "parser"]);
});

test("stable baseline: only tests passing in both runs", () => {
	assert.deepEqual(stablePassing(["a", "b", "c"], ["a", "c", "d"]), ["a", "c"]);
});
