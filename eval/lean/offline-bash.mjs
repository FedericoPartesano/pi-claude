#!/usr/bin/env node
// E2 (docs/specs/2026-10-08-lean-tools-design.md): real bash outputs before and after compactBash, and whether the
// facts the model needs (failing test, error line, summary) survive.
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { compactBash } from "../../extensions/lean/bash.ts";

const sh = (command, cwd) => {
	try {
		return { out: execSync(`${command} 2>&1`, { cwd, encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, FORCE_COLOR: "1" } }), code: 0 };
	} catch (error) {
		return { out: String(error.stdout ?? ""), code: error.status ?? 1 };
	}
};
const repos = join(homedir(), ".cache/pi-eval/repos");
const work = join(tmpdir(), "lean-e2");
rmSync(work, { recursive: true, force: true });
// Copies with one test broken on purpose (node_modules shared by symlink-free copy of sources only).
const broken = (repo, file, from, to) => {
	const dir = join(work, repo);
	execSync(`git clone --quiet --shared ${join(repos, repo)} ${dir} && cp -r ${join(repos, repo, "node_modules")} ${dir}/`);
	const path = join(dir, file);
	writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
	return dir;
};
const yaml = broken("yaml", "src/stringify/stringifyNumber.ts", "if (typeof value === 'bigint') return String(value)", "if (typeof value === 'bigint') return String(value) + 'x'");
const marked = broken("marked", "src/Tokenizer.ts", "type: 'hr'", "type: 'hrx'");
const fixture = join(work, "fixture");
execSync(`node ${join(new URL(".", import.meta.url).pathname, "../fixture/build.mjs")} ${fixture}`);
const CASES = [
	{ name: "vitest yaml (1 test rotto)", dir: yaml, command: "npx vitest run --reporter=verbose", keep: [/stringify|bigint/i, /Tests\s+.*failed/] },
	{ name: "vitest yaml (reporter default)", dir: yaml, command: "npx vitest run", keep: [/FAIL/, /Tests\s+.*failed/] },
	{ name: "marked test:unit (1 test rotto)", dir: marked, command: "npm run build:esbuild >/dev/null 2>&1; node --test --test-reporter=spec test/unit/*.test.js", keep: [/✖/, /ℹ fail [1-9]/] },
	{ name: "marked specs (1 test rotto)", dir: marked, command: "node --test --test-reporter=spec test/run-spec-tests.js", keep: [/✖/, /ℹ fail [1-9]/] },
	{ name: "git log yaml", dir: join(repos, "yaml"), command: "git log --stat -n 200", keep: [/^commit /m] },
	{ name: "find marked", dir: join(repos, "marked"), command: "find . -path ./node_modules -prune -o -type f -print", keep: [/src\/Lexer\.ts|\.\/src/] },
	{ name: "log fixture 5000 righe", dir: fixture, command: "cat logs/app.log", keep: [/ERROR/] },
	{ name: "npm ls yaml", dir: join(repos, "yaml"), command: "npm ls --all", keep: [/vitest/] },
];
const tokens = (text) => Math.round(text.length / 3.6);
// What Pi's bash tool already gives the model: the last 2000 lines or 50 KB (the extension receives this text).
const piTruncate = (text) => {
	const lines = text.split("\n").slice(-2000);
	let bytes = 0;
	let start = lines.length;
	while (start > 0 && bytes + Buffer.byteLength(lines[start - 1]) + 1 <= 50 * 1024) bytes += Buffer.byteLength(lines[--start]) + 1;
	return lines.slice(start).join("\n");
};
console.log("Prima = output che Pi dà già al modello (ultime 2000 righe o 50 KB). Dopo = con lean-tools.\n\n| output | righe | token prima | token dopo | risparmio | informazioni chiave conservate |\n|---|---|---|---|---|---|");
let before = 0;
let after = 0;
for (const testCase of CASES) {
	const { out: raw, code } = sh(testCase.command, testCase.dir);
	const out = piTruncate(raw);
	// The extension compacts the full output Pi saved when it truncated, otherwise what the model got.
	const compact = compactBash(raw, { command: testCase.command, exitCode: code, fullOutputPath: "/tmp/full.log" }) ?? out;
	before += tokens(out);
	after += tokens(compact);
	const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
	// Kept = every key fact Pi's output had is still there; "+" = a fact Pi's output had lost and lean-tools shows.
	const lost = testCase.keep.filter((pattern) => pattern.test(plain(out)) && !pattern.test(plain(compact)));
	const gained = testCase.keep.filter((pattern) => !pattern.test(plain(out)) && pattern.test(plain(compact)));
	const kept = lost.length === 0;
	console.log(`| ${testCase.name} | ${out.split("\n").length} | ${tokens(out)} | ${tokens(compact)} | ${Math.round((1 - tokens(compact) / Math.max(1, tokens(out))) * 100)}% | ${kept ? "✓" : `✗ (${lost.join(" ")})`}${gained.length ? ` + ${gained.length} recuperate` : ""} |`);
}
console.log(`| **totale** | | **${before}** | **${after}** | **${Math.round((1 - after / before) * 100)}%** | |`);
