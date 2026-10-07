#!/usr/bin/env node
// Location-tolerant re-scoring of an intent evaluation run.
// The checks import the new module from the expected path (e.g. src/cart.js): a correct function placed in another
// file failed every behavioral requirement, not just the API one. Here, on a copy of each work folder, a missing or
// incomplete expected module re-exports the function (same name) from the src/ file that defines it. The API
// requirement keeps the strict original verdict; behavioral requirements use the tolerant one.
// Usage: node intent-recheck.mjs <run>   → results/<run>.recheck.jsonl, then: node intent-analyze.mjs <run>.recheck
import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cases } from "./intent-cases.mjs";

const run = process.argv[2];
if (!run) throw new Error("uso: node intent-recheck.mjs <run>");
const evalDirectory = new URL(".", import.meta.url).pathname;
const resultsFile = join(evalDirectory, "results", `${run}.jsonl`);
const outFile = join(evalDirectory, "results", `${run}.recheck.jsonl`);
const workRoot = join(homedir(), ".cache/pi-eval/work", run);

// New modules the cases ask for, with the function each must export.
const EXPECTED = { ic01: ["src/cart.js", "cartTotal"], ic02: ["src/search.js", "searchCatalog"], ic03: ["src/report.js", "exportStockReport"] };

const listJs = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
	const path = join(dir, entry.name);
	return entry.isDirectory() ? listJs(path) : entry.name.endsWith(".js") ? [path] : [];
});

function shim(directory, file, name) {
	const target = join(directory, file);
	const exportsName = (path) => new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(readFileSync(path, "utf8"));
	if (existsSync(target) && exportsName(target)) return undefined;
	const source = listJs(join(directory, "src")).find((path) => path !== target && exportsName(path));
	if (!source) return undefined;
	const from = `./${relative(join(directory, "src"), source)}`;
	const existing = existsSync(target) ? `${readFileSync(target, "utf8")}\n` : "";
	writeFileSync(target, `${existing}export { ${name} } from ${JSON.stringify(from)};\n`);
	return from;
}

const scored = [];
for (const line of readFileSync(resultsFile, "utf8").split("\n").filter(Boolean)) {
	const record = JSON.parse(line);
	const testCase = cases.find((candidate) => candidate.id === record.case);
	const original = join(workRoot, `${record.case}-${record.arm}-${record.repetition}`);
	if (!testCase || !existsSync(original)) {
		scored.push(record);
		continue;
	}
	const copy = join(tmpdir(), `intent-recheck-${process.pid}`, `${record.case}-${record.arm}-${record.repetition}`);
	rmSync(copy, { recursive: true, force: true });
	cpSync(original, copy, { recursive: true });
	const moved = EXPECTED[record.case] ? shim(copy, ...EXPECTED[record.case]) : undefined;
	const sh = (command) => {
		try {
			return { code: 0, out: execSync(command, { cwd: copy, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }) };
		} catch (error) {
			return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
		}
	};
	const js = (code) => sh(`node --input-type=module -e ${JSON.stringify(code)}`).out.trim();
	const verdict = testCase.check({ dir: copy, sh, js });
	// Strict API verdict from the original run (moving the function must not count as the right API).
	const strictApi = /✓ API/.test(record.detail) ? 1 : 0;
	const met = verdict.metNoApi + strictApi;
	scored.push({
		...record,
		met,
		metNoApi: verdict.metNoApi,
		pass: met === verdict.total,
		detail: `${moved ? `[funzione trovata in ${moved}] ` : ""}${verdict.detail}`,
	});
	rmSync(copy, { recursive: true, force: true });
}
writeFileSync(outFile, scored.map((record) => JSON.stringify(record)).join("\n") + "\n");
console.log(`${scored.length} risultati → ${outFile}`);
