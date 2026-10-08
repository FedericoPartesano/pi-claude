import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../memory-rules.mjs";

const rule = (id) => RULES.find((entry) => entry.id === id);
const change = (path, ...added) => ({ path, added });

test("R1 Italian errors, R2 JSDoc, R6 no console.log", () => {
	assert.equal(rule("R1").check(null, { files: [change("src/a.ts", 'throw new Error("il valore deve essere un numero")')] }), "ok");
	assert.equal(rule("R1").check(null, { files: [change("src/a.ts", 'throw new Error("value must be a number")')] }), "violated");
	assert.equal(rule("R1").check(null, { files: [change("src/a.ts", "const x = 1")] }), "na");
	assert.equal(rule("R2").check(null, { files: [change("src/a.ts", "/** Somma. */", "export function sum(a, b) {")] }), "ok");
	assert.equal(rule("R2").check(null, { files: [change("src/a.ts", "export function sum(a, b) {")] }), "violated");
	assert.equal(rule("R6").check(null, { files: [change("src/a.ts", "console.log(x)")] }), "violated");
	assert.equal(rule("R6").check(null, { files: [change("tests/a.test.ts", "console.log(x)")] }), "na");
});

test("R4 new test file with the suffix, R5 changelog line", () => {
	assert.equal(rule("R4").check(null, { files: [change("tests/sum.round2.test.ts", "test('x', () => {})")], newFiles: ["tests/sum.round2.test.ts"] }), "ok");
	assert.equal(rule("R4").check(null, { files: [change("tests/doc.ts", "test('x', () => {})")], newFiles: [] }), "violated");
	assert.equal(rule("R5").check(null, { files: [change("CHANGES-local.md", "- [2026-10-08] somma"), change("src/a.ts", "x")] }), "ok");
	assert.equal(rule("R5").check(null, { files: [change("src/a.ts", "x")] }), "violated");
	assert.equal(rule("R5").check(null, { files: [] }), "na");
});

test("changes: added lines and new files, never the agents' memory files (.pi/, CLAUDE.md, AGENTS.md) or the eval marker", async () => {
	const { execSync } = await import("node:child_process");
	const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { changes } = await import("../memory-rules.mjs");
	const dir = mkdtempSync(join(tmpdir(), "changes-"));
	execSync("git init -q && git config user.email t@t && git config user.name t && mkdir src && echo 'a' > src/a.ts && git add . && git commit -qm base", { cwd: dir });
	writeFileSync(join(dir, "src/a.ts"), "a\nexport function b() {}\n");
	writeFileSync(join(dir, "CHANGES-local.md"), "- [2026-10-08] b\n");
	mkdirSync(join(dir, ".pi"));
	writeFileSync(join(dir, ".pi/memory.md"), "regole\n");
	writeFileSync(join(dir, "CLAUDE.md"), "regole\n");
	writeFileSync(join(dir, ".pi-eval-taught"), "1\n");
	const result = changes(dir);
	assert.deepEqual(result.files.map((file) => file.path).sort(), ["CHANGES-local.md", "src/a.ts"]);
	assert.deepEqual(result.files.find((file) => file.path === "src/a.ts").added, ["export function b() {}"]);
	assert.deepEqual(result.newFiles, ["CHANGES-local.md"]);
});

test("changes are measured against the pinned base, so an agent's commit does not hide them", async () => {
	const { execSync } = await import("node:child_process");
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { changes } = await import("../memory-rules.mjs");
	const dir = mkdtempSync(join(tmpdir(), "committed-"));
	const sh = (command) => execSync(command, { cwd: dir, encoding: "utf8" }).trim();
	sh("git init -q && git config user.email t@t && git config user.name t && mkdir src && echo '{}' > package.json && echo a > src/a.ts && git add . && git commit -qm base");
	const base = sh("git rev-parse HEAD");
	writeFileSync(join(dir, "src/a.ts"), "a\nconsole.log(1)\n");
	writeFileSync(join(dir, "package.json"), '{"dependencies":{"lodash":"1"}}');
	sh("git commit -qam 'agent commit'");
	const changed = changes(dir, base);
	assert.deepEqual(changed.files.find((file) => file.path === "src/a.ts")?.added, ["console.log(1)"]);
	assert.equal(RULES.find((rule) => rule.id === "R3").check(dir, changed), "violated");
});
