#!/usr/bin/env node
// Round 2: runs the mined tasks on Claude Code and pi-full (Opus, effort high) and checks them with the fix's tests.
// Usage: node run.mjs --run <name> [--harness claude-code,pi-full] [--repeat 2] [--only id1,id2] [--concurrency 2]
// Same --run again resumes. Stops starting jobs when the subscription goes into extra usage.
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkTask } from "./check.mjs";
import { jobsFor, promptFor } from "./jobs.mjs";
import { piFullExtensionArgs } from "./pi-full-args.mjs";
import { overageActive } from "./quota.mjs";
import { REPOS } from "./repos.mjs";
import { checkoutAt } from "./workdir.mjs";

// Hard tasks with Opus take more than the harness's default 5 minutes per turn (measured: both cut off mid-fix).
process.env.EVAL_TURN_TIMEOUT_MS ??= "1800000";
const { ClaudeCodeHarness, PiHarness } = await import("../harness.mjs");

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const runName = argument("run");
if (!runName) throw new Error("serve --run <nome>");
const harnesses = argument("harness", "claude-code,pi-full").split(",");
const repeat = Number(argument("repeat", "2"));
const only = argument("only", "").split(",").filter(Boolean);
const concurrency = Number(argument("concurrency", "2"));
const model = "opus";
const evalDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(evalDir, "../..");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
const resultsFile = join(evalDir, "../results", `${runName}.jsonl`);
const logDir = join(evalDir, "../logs", runName);
mkdirSync(logDir, { recursive: true });
mkdirSync(join(evalDir, "../results"), { recursive: true });

const tasks = JSON.parse(readFileSync(join(evalDir, "tasks.json"), "utf8")).filter((task) => !only.length || only.includes(task.id));
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).key) : []);
const queue = jobsFor(tasks, harnesses, repeat, done);
const clones = join(homedir(), ".cache/pi-eval/repos");
let stopped = false;

async function runJob({ key, task, harness, attempt }) {
	if (overageActive()) {
		stopped = true;
		return console.log(`STOP extra usage attivo: ${key} non parte`);
	}
	const repo = REPOS[task.repo];
	const clone = join(clones, task.repo);
	const name = key.replaceAll("|", "-");
	const dir = join(homedir(), ".cache/pi-eval/work2", runName, name);
	checkoutAt(clone, task.base, dir);
	execSync(repo.install, { cwd: dir, stdio: "ignore", timeout: 600_000 });
	const agent = harness === "claude-code"
		? new ClaudeCodeHarness(dir, model, { effort: "high" })
		: new PiHarness(dir, model, join(logDir, `${name}.log`), { extraArgs: ["--thinking", "high", ...piFullExtensionArgs(repoRoot, agentDir)] });
	const started = Date.now();
	const turn = await agent.runTurn(promptFor(task));
	agent.close();
	const changedFiles = execSync("git status --porcelain", { cwd: dir, encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
	const verdict = checkTask(dir, task, repo, (path) => execSync(`git show ${task.fix}:${JSON.stringify(path)}`, { cwd: clone, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
	const record = {
		key, task: task.id, repo: task.repo, harness, attempt, ...verdict,
		seconds: Math.round((Date.now() - started) / 100) / 10,
		requests: turn.requests, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens,
		tools: turn.tools, errors: turn.errors, timedOut: turn.timedOut, denials: turn.denials,
		changedFiles,
		answer: turn.answer.slice(0, 600),
	};
	appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
	console.log(`${record.pass ? "PASS" : "FAIL"} ${key.padEnd(34)} ${record.seconds}s in=${record.inputTokens} out=${record.outputTokens} ${record.reason}`);
}

await Promise.all(Array.from({ length: concurrency }, async () => {
	while (queue.length && !stopped) await runJob(queue.shift());
}));
console.log(stopped ? `fermato per extra usage → ${resultsFile}` : `fatto → ${resultsFile}`);
