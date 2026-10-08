import { test } from "node:test";
import assert from "node:assert/strict";
import { compactBash } from "./lean/bash.ts";

const lines = (n: number, make = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => make(i + 1)).join("\n");

test("small outputs, failing commands under 300 lines and PI_LEAN_FULL=1 are left alone", () => {
	assert.equal(compactBash(lines(100), { command: "cat x" }), undefined);
	assert.equal(compactBash(lines(250), { command: "make", exitCode: 2 }), undefined);
	assert.equal(compactBash(lines(500), { command: "PI_LEAN_FULL=1 cat big.log" }), undefined);
});

test("a long output keeps its head and tail and says where the rest is", () => {
	const out = compactBash(lines(500), { command: "cat big.log", fullOutputPath: "/tmp/pi-bash-1.log" }) ?? "";
	const kept = out.split("\n");
	assert.equal(kept[0], "line 1");
	assert.equal(kept.at(-1), "line 500");
	assert.ok(kept.includes("line 40") && !kept.includes("line 41") && kept.includes("line 441"));
	assert.match(out, /\[… 400 righe omesse: output completo in \/tmp\/pi-bash-1\.log\]/);
});

test("ANSI codes go, repeated lines collapse, very long lines are cut", () => {
	const noisy = ["\x1b[32mgreen\x1b[0m", ...Array(200).fill("same"), "x".repeat(1000), ...Array(10).fill("tail")].join("\n");
	const out = compactBash(noisy, { command: "build" }) ?? "";
	assert.match(out, /^green\n/);
	assert.match(out, /same\n\[… la riga sopra si ripete altre 199 volte\]/);
	assert.ok(out.split("\n").every((line) => line.length <= 420));
});

test("test output: failures and summary stay, passing tests become a count", () => {
	const suite = [
		...Array.from({ length: 150 }, (_, i) => `✔ parses case ${i} (0.1ms)`),
		"✖ handles anchors (2.1ms)",
		"  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
		"  + actual - expected",
		"  at TestContext.<anonymous> (file:///r/test/a.test.js:12:10)",
		...Array.from({ length: 30 }, (_, i) => `✔ more ${i}`),
		"ℹ tests 182",
		"ℹ pass 181",
		"ℹ fail 1",
	].join("\n");
	const out = compactBash(suite, { command: "npm test", exitCode: 1 }) ?? "";
	assert.match(out, /✖ handles anchors/);
	assert.match(out, /AssertionError/);
	assert.match(out, /test\/a\.test\.js:12:10/);
	assert.match(out, /ℹ fail 1/);
	assert.match(out, /\[180 test passati omessi\]/);
	assert.doesNotMatch(out, /parses case 7 /);
	const vitest = [...Array.from({ length: 130 }, (_, i) => ` ✓ tests/x.ts > case ${i} 1ms`), " × tests/x.ts > breaks", "   → expected 1 to be 2", " Test Files  1 failed (1)", "      Tests  1 failed | 130 passed (131)"].join("\n");
	const compact = compactBash(vitest, { command: "npx vitest run", exitCode: 1 }) ?? "";
	assert.match(compact, /× tests\/x\.ts > breaks\n {3}→ expected 1 to be 2/);
	assert.match(compact, /\[130 test passati omessi\]/);
});

test("many failures: the summary always survives the cut, and node's group headers are noise", () => {
	const groups = Array.from({ length: 40 }, (_, g) => [`▶ Group ${g}`, ...Array.from({ length: 30 }, (_, i) => `  ✔ case ${g}.${i} (0.1ms)`), `  ✖ case ${g}.x (1ms)`, `✖ Group ${g} (3ms)`]).flat();
	const details = Array.from({ length: 400 }, (_, i) => `  detail ${i}`);
	const suite = [...groups, "ℹ tests 1240", "ℹ pass 1200", "ℹ fail 40", "✖ failing tests:", ...details].join("\n");
	const out = compactBash(suite, { command: "node --test", exitCode: 1, fullOutputPath: "/tmp/f.log" }) ?? "";
	assert.match(out, /ℹ fail 40/);
	assert.match(out, /ℹ pass 1200/);
	assert.match(out, /✖ case 0\.x/);
	assert.doesNotMatch(out, /▶ Group/);
	assert.ok(out.split("\n").length < 260, `${out.split("\n").length} lines`);
});

test("grep/rg output run through bash is regrouped by file, losslessly (no new tool, no fixed cost); small or unrecognised output is left alone", async () => {
	const { regroupGrep } = await import("./lean/bash.ts");
	const hits = Array.from({ length: 20 }, (_, i) => `src/${i < 12 ? "a" : "b"}.ts:${i + 1}:  const x${i} = parse(y);`).join("\n");
	const out = regroupGrep(hits, "grep -rn parse src/") ?? "";
	assert.match(out, /^src\/a\.ts\n  1: {3}const x0 = parse\(y\);/);
	assert.equal(out.split("\n").filter((line) => line === "src/a.ts").length, 1, "path once");
	assert.equal(out.split("\n").filter((line) => /^  \d+: /.test(line)).length, 20, "lossless: every line the model asked for is there");
	assert.ok(out.length < hits.length);
	assert.equal(regroupGrep(hits.split("\n").slice(0, 5).join("\n"), "grep -rn parse src/"), undefined, "small output stays");
	assert.equal(regroupGrep(hits, "cat src/a.ts"), undefined, "not a search command");
	assert.equal(regroupGrep("just text\n".repeat(30), "grep -r foo ."), undefined, "no line numbers: left alone");
	assert.equal(regroupGrep(hits, "grep -rn parse src/ | wc -l"), undefined, "piped elsewhere: not grep's own output");
});
