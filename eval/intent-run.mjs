#!/usr/bin/env node
// Intent evaluation: vague feature requests with hidden requirements (intent-cases.mjs).
//   A — Pi direct: the vague request only, one turn.
//   B — Pi + intent: /intent <vague> interview answered by the simulated user (sim-user.mjs, knows the hidden
//       requirements), then /goal @intents/<file> (or one plain "implement the intent" turn with --b-mode plain).
// Usage: node intent-run.mjs [--arms A,B] [--only ic01,ic02] [--repeat 2] [--run name] [--concurrency 2]
// Same --run again = resume (completed jobs are skipped).
//                            [--b-mode goal|plain] [--model sonnet]
// Output: results/<run>.jsonl (one line per case × arm × repetition) and logs/<run>/<case>-<arm>-<n>.log.
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cases } from "./intent-cases.mjs";
import { interviewPrompt } from "../extensions/intent.ts";
import { PiHarness } from "./harness.mjs";
import { answer } from "./sim-user.mjs";

const argument = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1];
};
const arms = argument("arms", "A,B").split(",");
const only = argument("only", "").split(",").filter(Boolean);
const repeat = Number(argument("repeat", "1"));
const concurrency = Number(argument("concurrency", "2"));
const model = argument("model", "sonnet");
const runName = argument("run", `intent-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const repo = new URL("..", import.meta.url).pathname;
const goalExtension = join(repo, "extensions/goal.ts");
const bMode = argument("b-mode", existsSync(goalExtension) ? "goal" : "plain");
const MAX_INTERVIEW_TURNS = 8;
const MAX_FOLLOW_UP_TURNS = 4;
const NO_AGENT_MS = 20_000;
const TURN_TIMEOUT_MS = Number(process.env.EVAL_TURN_TIMEOUT_MS ?? 900_000);

const evalDirectory = new URL(".", import.meta.url).pathname;
const workRoot = join(homedir(), ".cache/pi-eval/work", runName);
const logDirectory = join(evalDirectory, "logs", runName);
const resultsFile = join(evalDirectory, "results", `${runName}.jsonl`);
mkdirSync(logDirectory, { recursive: true });
mkdirSync(join(evalDirectory, "results"), { recursive: true });

// Stop before the subscription runs out (same file pi-claude-code writes after every answer).
function budgetProblem() {
	try {
		const usage = JSON.parse(readFileSync(join(homedir(), ".pi/agent/claude-code-usage.json"), "utf8"));
		if (usage.isUsingOverage) return "abbonamento in extra usage";
		if ((usage.fiveHourUtilization ?? 0) >= Number(process.env.EVAL_MAX_5H ?? 0.85)) return `finestra 5h al ${Math.round(usage.fiveHourUtilization * 100)}%`;
	} catch {}
	return undefined;
}

// Like PiHarness.runTurn, but also ends the turn when a slash command does not start the agent, and records the
// extension notifications (e.g. goal status) seen during the turn.
function runTurn(harness, prompt) {
	const turn = { prompt, answer: "", seconds: 0, requests: 0, inputTokens: 0, outputTokens: 0, tools: [], errors: [], notes: [], timedOut: false };
	const started = Date.now();
	return new Promise((resolve) => {
		let agentStarted = false;
		let noAgentTimer;
		const finish = () => {
			clearTimeout(timer);
			clearTimeout(noAgentTimer);
			harness.process.listeners.delete(listener);
			turn.seconds = Math.round((Date.now() - started) / 100) / 10;
			resolve(turn);
		};
		const timer = setTimeout(() => {
			turn.timedOut = true;
			harness.process.send({ type: "abort" });
			setTimeout(finish, 3000);
		}, TURN_TIMEOUT_MS);
		const listener = (record) => {
			if (record.type === "__exit__") {
				turn.errors.push(`process exited: ${harness.process.stderr.slice(-300)}`);
				return finish();
			}
			if (record.type === "response" && record.command === "prompt") {
				if (record.success === false) turn.errors.push(`rpc: ${record.error}`);
				noAgentTimer = setTimeout(() => !agentStarted && finish(), NO_AGENT_MS);
			}
			if (record.type === "agent_start") agentStarted = true;
			if (record.type === "extension_ui_request" && record.method === "notify") turn.notes.push(String(record.message).slice(0, 300));
			if (record.type === "message_end" && record.message?.role === "assistant") {
				const message = record.message;
				turn.requests++;
				turn.inputTokens += (message.usage?.input ?? 0) + (message.usage?.cacheRead ?? 0) + (message.usage?.cacheWrite ?? 0);
				turn.outputTokens += message.usage?.output ?? 0;
				const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
				if (text) turn.answer = text;
				if (message.errorMessage) turn.errors.push(`[${message.stopReason}] ${message.errorMessage}`);
			}
			if (record.type === "tool_execution_start") turn.tools.push(record.toolName);
			if (record.type === "agent_settled") finish();
		};
		harness.process.listeners.add(listener);
		harness.process.send({ type: "prompt", message: prompt });
	});
}

const intentFiles = (directory) => {
	const folder = join(directory, "intents");
	return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".md")).sort() : [];
};
const ASK_FIRST_HINT = "Prima di scrivere codice: individua cosa la richiesta non specifica e cambierebbe il risultato (comportamento atteso, limiti e soglie, formati, casi limite, nomi di funzioni e file, cosa è fuori scope). Se c'è qualcosa, fai al massimo 3 domande mirate e fermati ad aspettare le risposte; se è tutto chiaro, procedi.";
const isQuestion = (text) => /\?\s*($|\n)|\?["»)]?\s*$/m.test(text);

async function runJob({ testCase, arm, repetition }) {
	const label = `${testCase.id}-${arm}-${repetition}`;
	const directory = join(workRoot, label);
	rmSync(directory, { recursive: true, force: true });
	execSync(`node ${JSON.stringify(join(evalDirectory, "fixture/build.mjs"))} ${JSON.stringify(directory)}`);

	const extraArgs = arm.startsWith("B") ? ["-e", join(repo, "extensions/intent.ts"), ...(bMode === "goal" ? ["-e", goalExtension] : [])] : [];
	// The advisor is off in both arms: arm B starts the interview explicitly, arm A must not be offered one.
	const harness = new PiHarness(directory, model, join(logDirectory, `${label}.log`), { extraArgs, environment: { PI_INTENT_ADVISOR: "off" } });
	const started = Date.now();
	const turns = [];
	const sim = { calls: 0, inputTokens: 0, outputTokens: 0, seconds: 0, errors: [] };
	const askSim = async (text) => {
		const reply = await answer(testCase.hidden, text.slice(-4000));
		sim.calls++;
		sim.inputTokens += reply.inputTokens;
		sim.outputTokens += reply.outputTokens;
		sim.seconds += reply.seconds;
		if (reply.error) sim.errors.push(reply.error);
		return reply.text || "decidi tu";
	};

	let intentFile;
	if (arm === "A") {
		turns.push(await runTurn(harness, testCase.vague));
	} else if (arm === "C" || arm === "D") {
		// Pi alone, but a present user: when Pi asks on its own, the same simulated user answers. This isolates what
		// the intent flow adds over Pi's spontaneous clarifying questions (arm A never gets an answer).
		// D: same, plus the light "ask first" hint the advisor would add to vague requests (no file, no dialog).
		turns.push(await runTurn(harness, arm === "D" ? `${testCase.vague}\n\n${ASK_FIRST_HINT}` : testCase.vague));
		while (isQuestion(turns.at(-1).answer) && !turns.at(-1).errors.length && turns.length < MAX_INTERVIEW_TURNS) {
			turns.push(await runTurn(harness, await askSim(turns.at(-1).answer)));
		}
	} else if (arm === "B3") {
		// The real advisor path: vague request → interview → intent → the work continues in the same turn (no separate
		// "implement the intent" message, no re-reading of what is already in context). Answer whatever Pi asks.
		turns.push(await runTurn(harness, interviewPrompt(testCase.vague, new Date().toISOString().slice(0, 10), { thenImplement: true })));
		while ((intentFiles(directory).length === 0 || isQuestion(turns.at(-1).answer)) && !turns.at(-1).errors.length && turns.length < MAX_INTERVIEW_TURNS + MAX_FOLLOW_UP_TURNS) {
			turns.push(await runTurn(harness, await askSim(turns.at(-1).answer)));
		}
		intentFile = intentFiles(directory)[0];
	} else {
		// Interview until the intent file exists.
		turns.push(await runTurn(harness, `/intent ${testCase.vague}`));
		while (intentFiles(directory).length === 0 && turns.length < MAX_INTERVIEW_TURNS) {
			const last = turns.at(-1);
			if (last.errors.some((error) => error.startsWith("process exited"))) break;
			// Until the intent file exists the interview is in progress: every answer goes to the simulated user
			// (questions do not always end with "?", e.g. "...per esempio X, Y oppure altro.").
			const reply = await askSim(last.answer);
			turns.push(await runTurn(harness, reply));
		}
		intentFile = intentFiles(directory)[0];
		if (intentFile) {
			const work = bMode === "goal" ? `/goal @intents/${intentFile}` : `Implementa l'intent intents/${intentFile} e verifica che i suoi outcome siano soddisfatti.`;
			turns.push(await runTurn(harness, work));
			// The model may still ask (e.g. open questions); answer a few times, like a present user.
			let followUps = 0;
			while (followUps < MAX_FOLLOW_UP_TURNS && isQuestion(turns.at(-1).answer) && !turns.at(-1).errors.length) {
				followUps++;
				turns.push(await runTurn(harness, await askSim(turns.at(-1).answer)));
			}
		}
	}
	harness.close();

	const sh = (command) => {
		try {
			return { code: 0, out: execSync(command, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }) };
		} catch (error) {
			return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
		}
	};
	const js = (code) => sh(`node --input-type=module -e ${JSON.stringify(code)}`).out.trim();
	let verdict;
	try {
		verdict = testCase.check({ dir: directory, sh, js });
	} catch (error) {
		verdict = { pass: false, met: 0, total: 1, detail: `check crashed: ${error.message}` };
	}
	const touchedTests = sh("git diff --name-only HEAD -- test/inventory.test.js test/format.test.js").out.trim().split("\n").filter(Boolean);
	const intentText = intentFile ? readFileSync(join(directory, "intents", intentFile), "utf8") : undefined;

	const record = {
		case: testCase.id,
		arm,
		repetition,
		bMode: arm.startsWith("B") ? bMode : undefined,
		pass: verdict.pass,
		met: verdict.met,
		total: verdict.total,
		metNoApi: verdict.metNoApi,
		totalNoApi: verdict.totalNoApi,
		detail: verdict.detail,
		seconds: Math.round((Date.now() - started) / 100) / 10,
		turnCount: turns.length,
		questions: sim.calls,
		requests: turns.reduce((sum, turn) => sum + turn.requests, 0),
		inputTokens: turns.reduce((sum, turn) => sum + turn.inputTokens, 0),
		outputTokens: turns.reduce((sum, turn) => sum + turn.outputTokens, 0),
		simInputTokens: sim.inputTokens,
		simOutputTokens: sim.outputTokens,
		intentFile,
		intentStatus: intentText ? /^status:\s*(\S+)/m.exec(intentText)?.[1] : undefined,
		touchedPreexistingTests: touchedTests,
		errors: [...turns.flatMap((turn) => turn.errors), ...sim.errors],
		timeouts: turns.filter((turn) => turn.timedOut).length,
		turns: turns.map((turn) => ({ prompt: turn.prompt.slice(0, 160), seconds: turn.seconds, requests: turn.requests, inputTokens: turn.inputTokens, tools: turn.tools.length, notes: turn.notes, answer: turn.answer.slice(0, 600) })),
	};
	appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
	if (intentText) writeFileSync(join(logDirectory, `${label}.intent.md`), intentText);
	console.log(`${record.pass ? "PASS" : "FAIL"} ${label.padEnd(10)} ${record.met}/${record.total} (no API ${record.metNoApi}/${record.totalNoApi}) ${record.seconds}s q=${record.questions} turns=${record.turnCount} in=${record.inputTokens} out=${record.outputTokens} sim=${record.simInputTokens}+${record.simOutputTokens} ${record.detail}`);
}

const selected = cases.filter((testCase) => !only.length || only.includes(testCase.id));
const jobs = [];
for (let repetition = 1; repetition <= repeat; repetition++) for (const testCase of selected) for (const arm of arms) jobs.push({ testCase, arm, repetition });
// Re-running with the same --run resumes: jobs already in the results file are skipped (e.g. after a budget stop).
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map((line) => {
	const record = JSON.parse(line);
	return `${record.case}/${record.arm}/${record.repetition}`;
}) : []);
const pending = jobs.filter((job) => !done.has(`${job.testCase.id}/${job.arm}/${job.repetition}`));
if (done.size > 0) console.log(`ripresa: ${jobs.length - pending.length} job già fatti, ne restano ${pending.length}`);
console.log(`${jobs.length} job · bracci ${arms.join(",")} · B=${bMode} · ${resultsFile}`);

const queue = [...pending];
let stopped;
await Promise.all(
	Array.from({ length: concurrency }, async () => {
		while (queue.length > 0 && !stopped) {
			const problem = budgetProblem();
			if (problem) {
				stopped = problem;
				break;
			}
			await runJob(queue.shift());
		}
	}),
);
console.log(stopped ? `FERMATO (${stopped}): ${queue.length} job non eseguiti` : `fatto: ${jobs.length} job → ${resultsFile}`);
