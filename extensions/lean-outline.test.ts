import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOutline, outline, symbolBody } from "./lean/outline.ts";

const TS = [
	"import { x } from './x';",
	"",
	"/** Parses things. */",
	"export function parse(text: string): Doc {",
	"  const a = { b: 1 };",
	"  if (a) {",
	"    return new Doc('}');",
	"  }",
	"  return new Doc(text);",
	"}",
	"",
	"export class Lexer extends Base {",
	"  private pos = 0;",
	"  next(): Token {",
	"    return this.read();",
	"  }",
	"  async *tokens() {",
	"    yield 1;",
	"  }",
	"}",
	"",
	"export const stringify = (value: unknown) => {",
	"  return String(value);",
	"};",
	"const helper = function () { return 1; };",
	"export default Lexer;",
].join("\n");

test("outline of TS/JS: functions, classes with methods, arrow functions, with lines", () => {
	const symbols = outline(TS, "a.ts");
	assert.deepEqual(symbols.map((s) => [s.kind, s.name, s.line, s.endLine]), [
		["function", "parse", 4, 10],
		["class", "Lexer", 12, 20],
		["method", "Lexer.next", 14, 16],
		["method", "Lexer.tokens", 17, 19],
		["function", "stringify", 22, 24],
		["function", "helper", 25, 25],
	]);
	assert.equal(formatOutline(symbols, 26), ["26 righe", "  4-10   function parse", "  12-20  class Lexer", "    14-16  method next", "    17-19  method tokens", "  22-24  function stringify", "  25     function helper"].join("\n"));
});

test("a symbol's body with line numbers, also a method by short or qualified name", () => {
	assert.equal(symbolBody(TS, "a.ts", "parse")?.split("\n")[0], "3\t/** Parses things. */", "the JSDoc right above comes along");
	assert.equal(symbolBody(TS, "a.ts", "parse")?.split("\n").length, 8);
	assert.match(symbolBody(TS, "a.ts", "Lexer.next") ?? "", /^14\t  next\(\): Token \{\n15\t    return this\.read\(\);\n16\t  \}$/);
	assert.match(symbolBody(TS, "a.ts", "next") ?? "", /^14\t/);
	assert.equal(symbolBody(TS, "a.ts", "missing"), undefined);
});

test("python by indentation", () => {
	const PY = ["import os", "", "class Cart:", "    def total(self):", "        s = 0", "        return s", "", "    def add(self, x):", "        pass", "", "def main():", "    print(1)", ""].join("\n");
	assert.deepEqual(outline(PY, "a.py").map((s) => [s.kind, s.name, s.line, s.endLine]), [
		["class", "Cart", 3, 9],
		["method", "Cart.total", 4, 6],
		["method", "Cart.add", 8, 9],
		["function", "main", 11, 12],
	]);
});

test("an object type in the signature does not end the function before its body", () => {
	const source = ["export function parse(text: string): { ok: true } | { ok: false; error: string } {", "  if (!text) return { ok: false, error: 'x' };", "  return { ok: true };", "}", "const one = function () { return 1; };"].join("\n");
	assert.deepEqual(outline(source, "a.ts").map((s) => [s.name, s.line, s.endLine]), [["parse", 1, 4], ["one", 5, 5]]);
});
