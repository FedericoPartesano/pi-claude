#!/usr/bin/env node
// Round-2 memory arm on yaml: teaching sessions played for real (Claude Code auto-memory vs Pi /dream), then new tasks
// in clean sessions; the "none" arm runs the tasks without teaching. Usage:
//   node memory-run.mjs --run <name> [--repeat 2] [--harness claude-code,pi-full] [--arms none,memory]
// Same --run resumes: an attempt whose teaching is done keeps its directory and memories and runs only missing tasks.
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { agentEnvironment, memoryStoresFor } from "./guards.mjs";
import { changes, MEMORY_BASE, RULES, TASKS, TEACH } from "./memory-rules.mjs";
import { piFullExtensionArgs } from "./pi-full-args.mjs";
import { overageActive } from "./quota.mjs";
import { REPOS } from "./repos.mjs";
import { checkoutAt } from "./workdir.mjs";

// Teaching sessions and tasks are small; 20 minutes per turn is plenty.
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
const logDir = join(evalDir, "../logs", runName);
mkdirSync(logDir, { recursive: true });
mkdirSync(join(evalDir, "../results"), { recursive: true });
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).key) : []);
const clone = join(homedir(), ".cache/pi-eval/repos/yaml");
const environment = agentEnvironment(mkdtempSync(join(tmpdir(), "pi-eval-gh-")));
const usageFile = join(agentDir, "claude-code-usage.json");
const MARKER = ".pi-eval-taught";
let live;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
	live?.close();
	process.exit(130);
});

// Pi saves its sessions where it normally does (one folder per project path), so /dream finds them like the user's.
const open = (harness, dir, log) => {
	live = harness === "claude-code"
		? new ClaudeCodeHarness(dir, "opus", { effort: "high", noWeb: true, environment, logPath: join(logDir, `${log}.log`), usageFile })
		: new PiHarness(dir, "opus", join(logDir, `${log}.log`), { environment, persistSession: true, extraArgs: ["--thinking", "high", ...piFullExtensionArgs(repoRoot, agentDir, { exclude: ["pi-web-access"] })] });
	return live;
};
const turn = async (harness, dir, log, prompts) => {
	const agent = open(harness, dir, log);
	try {
		const results = [];
		for (const prompt of prompts) results.push(await agent.runTurn(typeof prompt === "function" ? prompt() : prompt));
		return results;
	} finally {
		agent.close();
		live = undefined;
	}
};
// Back to the pinned base between sessions (commits included), keeping the agents' memory files and the marker.
const reset = (dir) => execSync(`git reset --quiet --hard ${MEMORY_BASE} && git clean -fdq -e node_modules -e .pi -e ${MARKER} -e CLAUDE.md -e AGENTS.md`, { cwd: dir });
const correction = (broken) => `Grazie. Però in questo progetto valgono queste regole, ricordale anche per le prossime volte:\n${broken.map((rule) => `- ${rule.text}`).join("\n")}\nSistema quello che hai fatto di conseguenza.`;

/** /dream as the user runs it (proposals auto-applied), repeated while sessions are pending; returns what happened. */
function dream(dir) {
	const runs = [];
	for (let run = 0; run < 5; run++) {
		rmSync(join(dir, ".pi/dream-last.json"), { force: true });
		const result = spawnSync("pi", ["--no-session", "--mode", "json", "-p", "/dream"], { cwd: dir, input: "", encoding: "utf8", timeout: 600_000, env: { ...process.env, ...environment, PI_DREAM_AUTO_APPROVE: "1" } });
		let last = {};
		try {
			last = JSON.parse(readFileSync(join(dir, ".pi/dream-last.json"), "utf8"));
		} catch {}
		runs.push({ status: result.status, error: result.error?.message, stderr: (result.stderr ?? "").slice(-300) || undefined, added: last.added, empty: last.empty, pending: last.pending });
		if (!last.pending) break;
	}
	return runs;
}

const piMemories = (dir) => {
	try {
		return readFileSync(join(dir, ".pi/memory/memories.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
};
const claudeMemoryFiles = (dir) => {
	const memory = join(memoryStoresFor(dir, homedir())[0], "memory");
	return existsSync(memory) ? readdirSync(memory) : [];
};

outer: for (const arm of arms) for (const harness of harnesses) for (let attempt = 1; attempt <= repeat; attempt++) {
	const prefix = `${arm}|${harness}|${attempt}`;
	const name = prefix.replaceAll("|", "-");
	if (TASKS.every((task) => done.has(`${prefix}|${task.id}`))) continue;
	if (overageActive()) {
		console.log("STOP extra usage attivo");
		break outer;
	}
	const dir = join(tmpdir(), "pi-eval2", runName, name);
	if (!existsSync(join(dir, MARKER))) {
		// A fresh start: no memory left from an earlier attempt at this path, for either harness.
		for (const store of memoryStoresFor(dir, homedir())) rmSync(store, { recursive: true, force: true });
		checkoutAt(clone, MEMORY_BASE, dir);
		execSync(REPOS.yaml.install, { cwd: dir, stdio: "ignore", timeout: 600_000 });
		const corrected = [];
		if (arm === "memory") {
			for (const [index, session] of TEACH.entries()) {
				let broken = [];
				await turn(harness, dir, `${name}-teach${index + 1}`, [session.prompt, () => {
					broken = RULES.filter((rule) => session.rules.includes(rule.id) && rule.check(dir, changes(dir, MEMORY_BASE)) === "violated");
					return broken.length ? correction(broken) : "Va bene così, grazie.";
				}]);
				corrected.push(broken.map((rule) => rule.id));
				reset(dir);
				console.log(`${prefix} insegnamento ${index + 1}: ${broken.length ? broken.map((rule) => rule.id).join(",") : "nessuna correzione"}`);
			}
		}
		const dreams = arm === "memory" && harness === "pi-full" ? dream(dir) : undefined;
		writeFileSync(join(dir, MARKER), `${new Date().toISOString()}\n`);
		appendFileSync(resultsFile, `${JSON.stringify({ key: `${prefix}|setup`, type: "setup", arm, harness, attempt, base: MEMORY_BASE, corrected, dream: dreams, piMemories: piMemories(dir), claudeMemoryFiles: claudeMemoryFiles(dir) })}\n`);
	}
	for (const task of TASKS) {
		const key = `${prefix}|${task.id}`;
		if (done.has(key)) continue;
		if (overageActive()) {
			console.log("STOP extra usage attivo");
			break outer;
		}
		const started = Date.now();
		const [result] = await turn(harness, dir, `${name}-${task.id}`, [task.prompt]);
		const changed = changes(dir, MEMORY_BASE);
		const rules = Object.fromEntries(RULES.map((rule) => [rule.id, rule.check(dir, changed)]));
		appendFileSync(resultsFile, `${JSON.stringify({ key, arm, harness, attempt, task: task.id, rules, inputTokens: result.inputTokens, outputTokens: result.outputTokens, seconds: Math.round((Date.now() - started) / 100) / 10, errors: result.errors })}\n`);
		console.log(`${key} ${Object.entries(rules).map(([id, state]) => `${id}:${state}`).join(" ")}`);
		reset(dir);
	}
}
