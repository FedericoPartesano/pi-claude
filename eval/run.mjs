#!/usr/bin/env node
// Runs the evaluation cases on Claude Code (native) and Pi (claude-code bridge).
// Usage: node run.mjs [--only id1,id2] [--harness claude-code|pi|pi-lean|pi-team] [--concurrency 3] [--run name]
// Output: results/<run>.jsonl (one line per case × harness) and logs/<run>/<case>-pi.log.
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const casesFile = process.argv.includes("--cases") ? process.argv[process.argv.indexOf("--cases") + 1] : "./cases.mjs";
const { cases } = await import(casesFile);
import { ClaudeCodeHarness, PiHarness } from "./harness.mjs";

const argument = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1];
};
const only = argument("only", "")?.split(",").filter(Boolean);
const harnessNames = argument("harness", "claude-code,pi").split(",");
const concurrency = Number(argument("concurrency", "3"));
const runName = argument("run", new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"));
const model = argument("model", "sonnet");

const evalDirectory = new URL(".", import.meta.url).pathname;
const workRoot = join(homedir(), ".cache/pi-eval/work", runName);
const logDirectory = join(evalDirectory, "logs", runName);
const resultsFile = join(evalDirectory, "results", `${runName}.jsonl`);
mkdirSync(logDirectory, { recursive: true });
mkdirSync(join(evalDirectory, "results"), { recursive: true });

const selected = cases.filter((testCase) => !only?.length || only.includes(testCase.id));
const jobs = selected.flatMap((testCase) => harnessNames.map((harnessName) => ({ testCase, harnessName })));

async function runJob({ testCase, harnessName }) {
	const directory = join(workRoot, `${testCase.id}-${harnessName}`);
	rmSync(directory, { recursive: true, force: true });
	execSync(`node ${JSON.stringify(join(evalDirectory, "fixture/build.mjs"))} ${JSON.stringify(directory)}`);

	// "pi-team": Pi with the team extension, plans auto-approved, told to use the team tool.
	const harness = harnessName === "pi-team"
		? new PiHarness(directory, model, join(logDirectory, `${testCase.id}-pi-team.log`), {
				extraArgs: ["-e", join(evalDirectory, "../pi-team")],
				environment: { PI_TEAM_AUTO_APPROVE: "1" },
			})
		: harnessName === "pi"
		? new PiHarness(directory, model, join(logDirectory, `${testCase.id}-pi.log`))
		: harnessName === "pi-lean"
		? new PiHarness(directory, model, join(logDirectory, `${testCase.id}-pi-lean.log`), { extraArgs: ["-e", join(evalDirectory, "../extensions/lean-tools.ts")] })
		: harnessName === "pi-lean0"
		? new PiHarness(directory, model, join(logDirectory, `${testCase.id}-pi-lean0.log`), { extraArgs: ["-e", join(evalDirectory, "../extensions/lean-tools.ts")], environment: { PI_LEAN_SEARCH: "0", PI_LEAN_OUTLINE: "0" } })
		: new ClaudeCodeHarness(directory, model);
	const started = Date.now();
	const turns = [];
	for (const prompt of testCase.turns) {
		const turn = await harness.runTurn(harnessName === "pi-team" ? `Usa il tool team per questo lavoro.\n\n${prompt}` : prompt);
		turns.push(turn);
		if (turn.errors.some((error) => error.startsWith("process exited"))) break;
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
		verdict = testCase.check({ dir: directory, turns, answer: turns.at(-1)?.answer ?? "", sh, js });
	} catch (error) {
		verdict = { pass: false, detail: `check crashed: ${error.message}` };
	}

	const record = {
		case: testCase.id,
		category: testCase.category,
		harness: harnessName,
		pass: verdict.pass,
		detail: verdict.detail,
		seconds: Math.round((Date.now() - started) / 100) / 10,
		turnCount: turns.length,
		requests: turns.reduce((sum, turn) => sum + turn.requests, 0),
		// Team sub-agents run in their own processes: add their usage from the team report.
		inputTokens: turns.reduce((sum, turn) => sum + turn.inputTokens + Number(/token input (\d+)/.exec(turn.teamReport ?? "")?.[1] ?? 0), 0),
		outputTokens: turns.reduce((sum, turn) => sum + turn.outputTokens + Number(/output (\d+) ·/.exec(turn.teamReport ?? "")?.[1] ?? 0), 0),
		teamOutcome: turns.map((turn) => /# Report del team — (.*)/.exec(turn.teamReport ?? "")?.[1]).filter(Boolean).join(" | ") || undefined,
		teamTasks: turns.reduce((sum, turn) => sum + ((turn.teamReport ?? "").match(/^- [✓✗⤼] /gm) ?? []).length, 0),
		errors: turns.flatMap((turn) => turn.errors),
		timeouts: turns.filter((turn) => turn.timedOut).length,
		denials: turns.reduce((sum, turn) => sum + turn.denials, 0),
		tools: turns.flatMap((turn) => turn.tools),
		turns: turns.map((turn) => ({ prompt: turn.prompt.slice(0, 80), seconds: turn.seconds, requests: turn.requests, inputTokens: turn.inputTokens, answer: turn.answer.slice(0, 400), teamReport: turn.teamReport })),
	};
	appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
	console.log(`${record.pass ? "PASS" : "FAIL"} ${testCase.id} ${harnessName.padEnd(11)} ${record.seconds}s req=${record.requests} in=${record.inputTokens} out=${record.outputTokens} err=${record.errors.length} ${record.detail}`);
}

const queue = [...jobs];
await Promise.all(
	Array.from({ length: concurrency }, async () => {
		while (queue.length > 0) await runJob(queue.shift());
	}),
);
console.log(`done: ${jobs.length} jobs → ${resultsFile}`);
