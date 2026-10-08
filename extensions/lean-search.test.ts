import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMatches, parseRgJson, rankFiles } from "./lean/search.ts";

const m = (path: string, line: number, text: string) => ({ path, line, text });

test("matches are grouped by file, the path printed once, capped per file and in total with counts", () => {
	const matches = [m("src/a.ts", 3, "const x = parse(y)"), m("src/a.ts", 9, "parse(z)"), m("src/b.ts", 1, "export function parse() {}")];
	assert.equal(formatMatches(matches, {}), ["src/a.ts", "  3: const x = parse(y)", "  9: parse(z)", "src/b.ts", "  1: export function parse() {}"].join("\n"));
	const many = Array.from({ length: 12 }, (_, i) => m("src/c.ts", i + 1, `hit ${i}`));
	const out = formatMatches(many, { perFile: 5 });
	assert.equal(out.split("\n").filter((line) => /^  \d/.test(line)).length, 5);
	assert.match(out, /… altri 7 in questo file/);
	const spread = Array.from({ length: 30 }, (_, i) => m(`f${i}.ts`, 1, "x"));
	const capped = formatMatches(spread, { total: 10 });
	assert.match(capped, /… e altri 20 risultati in 20 file/);
	assert.match(capped, /f10\.ts \(1\), f11\.ts \(1\)/, "the files left out are still named, so the right one is never hidden");
	const huge = formatMatches(Array.from({ length: 100 }, (_, i) => m(`g${i}.ts`, 1, "x")), { total: 10 });
	assert.match(huge, /… e altri 50 file/, "at most 40 names");
});

test("long lines are cut, and context lines are marked differently from matches", () => {
	const out = formatMatches([m("a.js", 1, "x".repeat(500))], { maxLine: 160 });
	assert.ok(out.split("\n")[1].length < 175);
	assert.match(out, /…$/);
	assert.match(formatMatches([{ path: "a.js", line: 2, text: "before", context: true }, m("a.js", 3, "hit")], {}), /  2- before\n  3: hit/);
});

test("rg --json output becomes matches (and context lines)", () => {
	const json = [
		{ type: "begin", data: { path: { text: "src/a.ts" } } },
		{ type: "context", data: { path: { text: "src/a.ts" }, line_number: 2, lines: { text: "before\n" } } },
		{ type: "match", data: { path: { text: "src/a.ts" }, line_number: 3, lines: { text: "  parse(x)\n" } } },
		{ type: "end", data: {} },
		{ type: "summary", data: {} },
	].map((record) => JSON.stringify(record)).join("\n");
	assert.deepEqual(parseRgJson(json), [{ path: "src/a.ts", line: 2, text: "before", context: true }, { path: "src/a.ts", line: 3, text: "  parse(x)" }]);
});

test("file names ranked: exact name (or name without extension), then prefix, then substring; shorter paths first, then alphabetical", () => {
	const files = ["test/unit/Lexer.test.js", "src/Lexer.ts", "src/rules/lexer-rules.ts", "docs/lexer.md", "src/Tokenizer.ts", "lib/lexer.ts"];
	assert.deepEqual(rankFiles(files, "lexer.ts"), ["lib/lexer.ts", "src/Lexer.ts"]);
	assert.deepEqual(rankFiles(files, "lexer"), ["lib/lexer.ts", "src/Lexer.ts", "docs/lexer.md", "test/unit/Lexer.test.js", "src/rules/lexer-rules.ts"]);
	assert.deepEqual(rankFiles(files, "rules/lex"), ["src/rules/lexer-rules.ts"], "a query with a slash matches the path");
});
