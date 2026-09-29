#!/usr/bin/env node
// Re-runs the checks of some cases on the working directories left by a run (no agent calls).
// Usage: node recheck.mjs <run> <case1,case2>   → rewrites results/<run>.jsonl in place.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cases } from "./cases.mjs";

const [run, caseList] = process.argv.slice(2);
const caseIds = caseList.split(",");
const evalDirectory = new URL(".", import.meta.url).pathname;
const resultsFile = join(evalDirectory, "results", `${run}.jsonl`);
const records = readFileSync(resultsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));

for (const record of records.filter((record) => caseIds.includes(record.case))) {
	const directory = join(homedir(), ".cache/pi-eval/work", run, `${record.case}-${record.harness}`);
	const sh = (command) => {
		try {
			return { code: 0, out: execSync(command, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }) };
		} catch (error) {
			return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
		}
	};
	const js = (code) => sh(`node --input-type=module -e ${JSON.stringify(code)}`).out.trim();
	const testCase = cases.find((candidate) => candidate.id === record.case);
	// Saved answers are truncated to 400 characters: fine for file-based checks.
	const verdict = testCase.check({ dir: directory, turns: record.turns, answer: record.turns.at(-1)?.answer ?? "", sh, js });
	console.log(`${record.case} ${record.harness}: ${record.pass} → ${verdict.pass} (${verdict.detail})`);
	record.pass = verdict.pass;
	record.detail = `${verdict.detail} [ricontrollato]`;
}
writeFileSync(resultsFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
