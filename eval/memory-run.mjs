#!/usr/bin/env node
// Memory evaluation (docs/specs/2026-10-06-memory-dream-design.md): do rules the user taught Pi in past sessions
// survive into new sessions, and at what token cost?
//   none  — no memory: a fresh fixture, the task only
//   dream — synthetic past sessions consolidated by /dream (extensions/memory.ts) once per job, then the task with
//           the memory extension loaded
//   full  — control "everything in memory": the raw past sessions pasted before the task
// Usage: node memory-run.mjs [--arms none,dream] [--tasks mt1,mt2,mt3,mt4,mt5] [--probe] [--repeat 1] [--run name] [--concurrency 2]
//        (max 5 tasks per run; the "full" arm is optional and only estimated by default: --estimate-full)
//        node memory-run.mjs --selftest   (checks against reference solutions, no model calls)
// Same --run again resumes (completed jobs are skipped).
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkMemory, checkRules, references, tasks } from "./memory-cases.mjs";
import { FAKE_SECRETS, writeNoiseSessions, rawSessionsText, writeSessions } from "./memory-sessions.mjs";
import { PiHarness } from "./harness.mjs";

const argument = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1];
};
const evalDirectory = new URL(".", import.meta.url).pathname;
const repo = join(evalDirectory, "..");
const memoryExtension = join(repo, "extensions/memory.ts");
const buildFixture = (directory) => {
	rmSync(directory, { recursive: true, force: true });
	execSync(`node ${JSON.stringify(join(evalDirectory, "fixture/build.mjs"))} ${JSON.stringify(directory)}`, { stdio: "ignore" });
};

if (process.argv.includes("--selftest")) {
	// Each reference "ok" change must make every applicable rule pass; each "bad" change must violate at least one.
	const root = join(homedir(), ".cache/pi-eval/work/memory-selftest");
	let failures = 0;
	for (const [taskId, variants] of Object.entries(references)) {
		for (const [kind, edits] of Object.entries(variants)) {
			const directory = join(root, `${taskId}-${kind}`);
			buildFixture(directory);
			for (const [file, mode, content] of edits) {
				const path = join(directory, file);
				mkdirSync(join(path, ".."), { recursive: true });
				if (mode === "write") writeFileSync(path, content);
				else if (mode === "append") writeFileSync(path, readFileSync(path, "utf8") + content);
				else writeFileSync(path, readFileSync(path, "utf8").replace(content[0], content[1]));
			}
			const { rules } = checkRules(directory, taskId);
			const statuses = Object.entries(rules).map(([rule, result]) => `${rule}:${result.status}`).join(" ");
			const good = kind === "ok" ? Object.values(rules).every((result) => result.status !== "violated") : Object.values(rules).some((result) => result.status === "violated");
			if (!good) failures++;
			console.log(`${good ? "OK  " : "FAIL"} ${taskId}-${kind.padEnd(3)} ${statuses}`);
		}
	}
	console.log(failures ? `${failures} riferimenti giudicati male` : "tutti i riferimenti giudicati correttamente");
	process.exit(failures ? 1 : 0);
}

const arms = argument("arms", "none,dream").split(",");
const only = argument("tasks", "mt1,mt2,mt3,mt4,mt5").split(",").filter(Boolean);
if (only.length > 5) throw new Error("--tasks: al massimo 5 compiti per giro");
if (process.argv.includes("--estimate-full")) {
	const chars = rawSessionsText().length;
	console.log(`braccio full (stima): ~${Math.round(chars / 3.6)} token in più per richiesta (${chars} caratteri di sessioni grezze), contro il tetto di 1.000 della memoria`);
	process.exit(0);
}
const repeat = Number(argument("repeat", "1"));
const concurrency = Number(argument("concurrency", "2"));
const bury = Number(process.argv.includes("--bury") ? process.argv[process.argv.indexOf("--bury") + 1] : 0);
const model = argument("model", "sonnet");
const runName = argument("run", `memory-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const workRoot = join(homedir(), ".cache/pi-eval/work", runName);
const logDirectory = join(evalDirectory, "logs", runName);
const resultsFile = join(evalDirectory, "results", `${runName}.jsonl`);
mkdirSync(logDirectory, { recursive: true });
mkdirSync(join(evalDirectory, "results"), { recursive: true });

function budgetProblem() {
	try {
		const usage = JSON.parse(readFileSync(join(homedir(), ".pi/agent/claude-code-usage.json"), "utf8"));
		if (usage.isUsingOverage) return "abbonamento in extra usage";
		if ((usage.fiveHourUtilization ?? 0) >= Number(process.env.EVAL_MAX_5H ?? 0.97)) return `finestra 5h al ${Math.round(usage.fiveHourUtilization * 100)}%`;
	} catch {}
	return undefined;
}

// Runs /dream once in `directory` on the synthetic sessions; returns its token usage from the JSON event stream.
function consolidate(directory, sessionsRoot, label, memoryMode) {
	rmSync(join(directory, ".pi/dream-last.json"), { force: true });
	const started = Date.now();
	const result = spawnSync("pi", ["--no-session", "--mode", "json", "--provider", "claude-code", "--model", model, "-p", "/dream", "-e", memoryExtension], {
		cwd: directory,
		input: "", // stdin closed: pi -p otherwise waits for EOF
		encoding: "utf8",
		timeout: 600_000,
		env: { ...process.env, PI_DREAM_AUTO_APPROVE: "1", PI_DREAM_SESSIONS_DIR: sessionsRoot, PI_MEMORY_GLOBAL_PATH: "", ...(memoryMode ? { PI_MEMORY_MODE: memoryMode } : {}) },
	});
	writeFileSync(join(logDirectory, `${label}.dream.jsonl`), result.stdout ?? "");
	const usage = { requests: 0, inputTokens: 0, outputTokens: 0, exit: result.status, error: result.error?.message ?? (result.status ? (result.stderr ?? "").slice(-300) : undefined) };
	for (const line of (result.stdout ?? "").split("\n")) {
		try {
			const record = JSON.parse(line);
			if (record.type === "message_end" && record.message?.role === "assistant" && record.message.usage) {
				usage.requests++;
				usage.inputTokens += (record.message.usage.input ?? 0) + (record.message.usage.cacheRead ?? 0) + (record.message.usage.cacheWrite ?? 0);
				usage.outputTokens += record.message.usage.output ?? 0;
			}
		} catch {}
	}
	// The consolidation call goes through the model registry, not the session: its usage is in dream-last.json.
	try {
		const last = JSON.parse(readFileSync(join(directory, ".pi/dream-last.json"), "utf8"));
		usage.requests++;
		usage.inputTokens += (last.usage?.input ?? 0) + (last.usage?.cacheRead ?? 0) + (last.usage?.cacheWrite ?? 0);
		usage.outputTokens += last.usage?.output ?? 0;
		usage.pending = last.pending ?? 0;
		usage.empty = Boolean(last.empty);
	} catch {}
	usage.seconds = Math.round((Date.now() - started) / 1000);
	return usage;
}

// Per-request recall log written by the extension (PI_MEMORY_RECALL_LOG=1): injected memory and its size.
function recallSummary(directory) {
	const path = join(directory, ".pi/memory/recall-log.jsonl");
	if (!existsSync(path)) return undefined;
	const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
	const tokens = rows.map((row) => row.estTokens ?? Math.round((row.chars ?? 0) / 3.6));
	return { requests: rows.length, injectedTokens: tokens.reduce((a, b) => a + b, 0), maxTokens: Math.max(0, ...tokens), empty: rows.filter((row) => (row.injected ?? []).length === 0 && !row.chars).length, ids: [...new Set(rows.flatMap((row) => row.injected ?? []))] };
}

async function runJob({ task, arm, repetition }) {
	const label = `${task.id}-${arm}-${repetition}`;
	const directory = join(workRoot, label);
	buildFixture(directory);
	const started = Date.now();
	let dream;
	let memory;
	const memoryArm = ["dream", "capped", "deep"].includes(arm);
	// capped = memory with a cap always in the system prompt; deep = full archive + per-request recall.
	const memoryMode = arm === "capped" ? "capped" : arm === "deep" ? "deep" : undefined;
	if (memoryArm) {
		const sessionsRoot = join(workRoot, `${label}-sessions`);
		rmSync(sessionsRoot, { recursive: true, force: true });
		writeSessions(directory, sessionsRoot);
		if (bury > 0) writeNoiseSessions(directory, sessionsRoot, bury);
		// Consolidate the whole backlog (batches): repeat while /dream reports pending sessions.
		dream = { requests: 0, inputTokens: 0, outputTokens: 0, seconds: 0, runs: 0 };
		for (let round = 0; round < 8; round++) {
			const one = consolidate(directory, sessionsRoot, `${label}-r${round}`, memoryMode);
			dream.runs++;
			for (const key of ["requests", "inputTokens", "outputTokens", "seconds"]) dream[key] += one[key] ?? 0;
			dream.emptyReplies = (dream.emptyReplies ?? 0) + (one.empty ? 1 : 0);
			if (!one.pending && !one.empty) break;
		}
		memory = checkMemory(directory, FAKE_SECRETS);
		// Consolidation output is not part of the task's diff.
		execSync("git add -A .pi 2>/dev/null; git commit -qm memoria --allow-empty", { cwd: directory, stdio: "ignore" });
	}
	const extraArgs = memoryArm ? ["-e", memoryExtension] : [];
	const harness = new PiHarness(directory, model, join(logDirectory, `${label}.log`), { extraArgs, environment: { PI_INTENT_ADVISOR: "off", PI_MEMORY_GLOBAL_PATH: "", PI_MEMORY_RECALL_LOG: "1", ...(memoryMode ? { PI_MEMORY_MODE: memoryMode } : {}) } });
	const prompt = task.id === "probe" ? "Rispondi solo: ok" : task.prompt;
	const text = arm === "full" ? `Contesto: queste sono le conversazioni passate su questo progetto.\n\n${rawSessionsText()}\n\n---\n\n${prompt}` : prompt;
	const turn = await harness.runTurn(text);
	harness.close();
	const checked = task.id === "probe" ? { rules: {} } : checkRules(directory, task.id);
	const record = {
		task: task.id, arm, repetition,
		rules: Object.fromEntries(Object.entries(checked.rules).map(([rule, result]) => [rule, result.status])),
		ruleDetails: Object.fromEntries(Object.entries(checked.rules).map(([rule, result]) => [rule, result.detail])),
		newFiles: checked.newFiles, changedFiles: checked.changedFiles,
		requests: turn.requests, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, seconds: Math.round((Date.now() - started) / 1000),
		dream, memory, recall: recallSummary(directory),
		errors: [...turn.errors, ...(dream?.error ? [`dream: ${dream.error}`] : [])],
		answer: turn.answer.slice(0, 800),
	};
	appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
	const statuses = Object.entries(record.rules).map(([rule, status]) => `${rule}:${status === "ok" ? "✓" : status === "violated" ? "✗" : "·"}`).join(" ");
	console.log(`${label.padEnd(14)} ${statuses} req=${record.requests} in=${record.inputTokens} out=${record.outputTokens}${dream ? ` dream=${dream.inputTokens}+${dream.outputTokens}` : ""}${memory ? ` mem=${memory.exists ? `${memory.chars}c segreto=${memory.secretLeaked ? "SI" : "no"}` : "assente"}` : ""} ${record.recall ? ` richiamo=${record.recall.injectedTokens}tok/${record.recall.requests}req vuoti=${record.recall.empty}` : ""} ${record.errors.length ? `ERR ${record.errors[0].slice(0, 100)}` : ""}`);
}

if (arms.includes("dream") && !existsSync(memoryExtension)) {
	console.log(`braccio dream saltato: ${memoryExtension} non esiste ancora`);
	arms.splice(arms.indexOf("dream"), 1);
}
// --probe adds a "Rispondi solo: ok" job per arm: the per-request overhead of the memory in context.
const selected = [...(process.argv.includes("--probe") ? [{ id: "probe" }] : []), ...tasks.filter((task) => only.includes(task.id))];
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map((line) => {
	const record = JSON.parse(line);
	return `${record.task}/${record.arm}/${record.repetition}`;
}) : []);
const jobs = [];
for (let repetition = 1; repetition <= repeat; repetition++) for (const task of selected) for (const arm of arms) if (!done.has(`${task.id}/${arm}/${repetition}`)) jobs.push({ task, arm, repetition });
console.log(`${jobs.length} job · bracci ${arms.join(",")} · ${resultsFile}${done.size ? ` (ripresa: ${done.size} già fatti)` : ""}`);

let stopped;
await Promise.all(Array.from({ length: concurrency }, async () => {
	while (jobs.length > 0 && !stopped) {
		stopped = budgetProblem();
		if (stopped) break;
		await runJob(jobs.shift());
	}
}));
console.log(stopped ? `FERMATO (${stopped}): ${jobs.length} job non eseguiti` : `fatto → ${resultsFile}`);
