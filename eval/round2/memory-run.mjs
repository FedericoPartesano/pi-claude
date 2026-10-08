#!/usr/bin/env node
// Round-2 memory arm on yaml: teaching sessions played for real (Claude Code auto-memory vs Pi /dream), then new tasks
// in clean sessions; the "none" arm runs the tasks without teaching. Usage:
//   node memory-run.mjs --run <name> [--repeat 2] [--harness claude-code,pi-full] [--arms none,memory]
// Same --run resumes. One directory per arm × harness × attempt for the whole run: both memories are tied to the path.
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { changes, RULES, TASKS, TEACH } from "./memory-rules.mjs";
import { piFullExtensionArgs } from "./pi-full-args.mjs";
import { overageActive } from "./quota.mjs";
import { REPOS } from "./repos.mjs";
import { checkoutAt } from "./workdir.mjs";

// Hard tasks with Opus take more than the harness's default 5 minutes per turn (measured: both cut off mid-fix).
process.env.EVAL_TURN_TIMEOUT_MS ??= "1200000";
const { ClaudeCodeHarness, PiHarness } = await import("../harness.mjs");

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const runName = argument("run");
if (!runName) throw new Error("serve --run <nome>");
const repeat = Number(argument("repeat", "2"));
const harnesses = argument("harness", "claude-code,pi-full").split(",");
const arms = argument("arms", "none,memory").split(",");
const evalDir = new URL(".", import.meta.url).pathname;
const repoRoot = join(evalDir, "../..");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
const resultsFile = join(evalDir, "../results", `${runName}.jsonl`);
mkdirSync(join(evalDir, "../results"), { recursive: true });
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).key) : []);
const clone = join(homedir(), ".cache/pi-eval/repos/yaml");
const HEAD = execSync("git rev-parse HEAD", { cwd: clone, encoding: "utf8" }).trim();

// Pi saves its sessions where it normally does (one folder per project path), so /dream finds them like the user's.
const open = (harness, dir) => harness === "claude-code"
	? new ClaudeCodeHarness(dir, "opus", { effort: "high" })
	: new PiHarness(dir, "opus", undefined, { persistSession: true, extraArgs: ["--thinking", "high", ...piFullExtensionArgs(repoRoot, agentDir)] });
// Back to a clean tree between sessions, keeping Pi's memory in .pi/.
const reset = (dir) => execSync("git checkout --quiet . && git clean -fdq -e node_modules -e .pi", { cwd: dir });
const correction = (broken) => `Grazie. Però in questo progetto valgono queste regole, ricordale anche per le prossime volte:\n${broken.map((rule) => `- ${rule.text}`).join("\n")}\nSistema quello che hai fatto di conseguenza.`;

/** /dream as the user runs it (proposals auto-applied), repeated while sessions are pending. */
function dream(dir) {
	for (let run = 0; run < 5; run++) {
		rmSync(join(dir, ".pi/dream-last.json"), { force: true });
		spawnSync("pi", ["--no-session", "--mode", "json", "-p", "/dream"], { cwd: dir, input: "", encoding: "utf8", timeout: 600_000, env: { ...process.env, PI_DREAM_AUTO_APPROVE: "1" } });
		let pending = 0;
		try {
			pending = JSON.parse(readFileSync(join(dir, ".pi/dream-last.json"), "utf8")).pending ?? 0;
		} catch {}
		if (!pending) return;
	}
}

for (const arm of arms) for (const harness of harnesses) for (let attempt = 1; attempt <= repeat; attempt++) {
	const prefix = `${arm}|${harness}|${attempt}`;
	if (TASKS.every((task) => done.has(`${prefix}|${task.id}`))) continue;
	if (overageActive()) {
		console.log("STOP extra usage attivo");
		process.exit(0);
	}
	const dir = join(homedir(), ".cache/pi-eval/work2", runName, prefix.replaceAll("|", "-"));
	checkoutAt(clone, HEAD, dir);
	execSync(REPOS.yaml.install, { cwd: dir, stdio: "ignore", timeout: 600_000 });
	if (arm === "memory") {
		for (const session of TEACH) {
			const agent = open(harness, dir);
			await agent.runTurn(session.prompt);
			const broken = RULES.filter((rule) => session.rules.includes(rule.id) && rule.check(dir, changes(dir)) === "violated");
			if (broken.length) await agent.runTurn(correction(broken));
			agent.close();
			reset(dir);
			console.log(`${prefix} insegnamento: ${broken.length ? broken.map((rule) => rule.id).join(",") : "nessuna correzione"}`);
		}
		if (harness === "pi-full") dream(dir);
	}
	for (const task of TASKS) {
		const key = `${prefix}|${task.id}`;
		if (done.has(key)) continue;
		if (overageActive()) {
			console.log("STOP extra usage attivo");
			process.exit(0);
		}
		const agent = open(harness, dir);
		const started = Date.now();
		const turn = await agent.runTurn(task.prompt);
		agent.close();
		const changed = changes(dir);
		const rules = Object.fromEntries(RULES.map((rule) => [rule.id, rule.check(dir, changed)]));
		appendFileSync(resultsFile, `${JSON.stringify({ key, arm, harness, attempt, task: task.id, rules, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, seconds: Math.round((Date.now() - started) / 100) / 10, errors: turn.errors })}\n`);
		console.log(`${key} ${Object.entries(rules).map(([id, state]) => `${id}:${state}`).join(" ")}`);
		reset(dir);
	}
}
