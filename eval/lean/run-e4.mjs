#!/usr/bin/env node
// E4 runner: pi vs pi + lean-tools on code-navigation questions in a copy of marked. Usage: node run-e4.mjs --run <name> [--repeat 2]
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
import { cases, MARKED_BASE } from "./e4-cases.mjs";

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const runName = argument("run", "lean-e4");
const repeat = Number(argument("repeat", "2"));
const evalDir = new URL("..", import.meta.url).pathname;
const resultsFile = join(evalDir, "results", `${runName}.jsonl`);
mkdirSync(join(evalDir, "results"), { recursive: true });
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).key) : []);
const lean = join(evalDir, "../extensions/lean-tools.ts");
const harnesses = (argument("harness", "pi,pi-lean")).split(",");
const jobs = cases.flatMap((testCase) => Array.from({ length: repeat }, (_, i) => harnesses.map((harness) => ({ testCase, harness, attempt: i + 1 }))).flat());
const queue = jobs.filter((job) => !done.has(`${job.testCase.id}|${job.harness}|${job.attempt}`));
await Promise.all(Array.from({ length: 3 }, async () => {
	while (queue.length) {
		const { testCase, harness, attempt } = queue.shift();
		const key = `${testCase.id}|${harness}|${attempt}`;
		const dir = join(tmpdir(), "pi-lean-e4", runName, key.replaceAll("|", "-"));
		checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), MARKED_BASE, dir);
		// pi-lean0: zero fixed cost (no new tools): re-reads, bash compaction and grep regrouping only.
		const agent = new PiHarness(dir, "sonnet", undefined, { extraArgs: harness === "pi" ? [] : ["-e", lean], environment: harness === "pi-lean0" ? { PI_LEAN_SEARCH: "0", PI_LEAN_OUTLINE: "0" } : {} });
		const turn = await agent.runTurn(testCase.prompt);
		agent.close();
		const record = { key, case: testCase.id, harness, attempt, pass: testCase.check(turn.answer), seconds: turn.seconds, requests: turn.requests, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, tools: turn.tools, errors: turn.errors, answer: turn.answer.slice(0, 400) };
		appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
		console.log(`${record.pass ? "PASS" : "FAIL"} ${key.padEnd(18)} in=${record.inputTokens} req=${record.requests} tools=${record.tools.join(",")}`);
	}
}));
