#!/usr/bin/env node
// Fixed-plan comparison of the team with and without the CRM protocol: same plan, same fixture, no main session,
// so only the closing protocol differs. Usage: node team-crm-fixed.mjs [--rounds 2] [--run name]
// Output: results/<run>.jsonl, one line per arm x round.
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cases } from "./team-cases.mjs";
import { runTeamPlan } from "../pi-team/src/orchestrator.ts";
import { loadRoles } from "../pi-team/src/roles.ts";
import { runAgent } from "../pi-team/src/runner.ts";
import { runVerifyCommands } from "../pi-team/src/verify.ts";

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const rounds = Number(argument("rounds", "2"));
const runName = argument("run", "team-crm-fixed-r1");
const here = new URL(".", import.meta.url).pathname;
const resultsFile = join(here, "results", `${runName}.jsonl`);
mkdirSync(join(here, "results"), { recursive: true });

const plan = {
	goal: "Correggi 5 bug in src/ e aggiungi un test per ognuno: totalValue ignora la quantità; formatPrice(-150) deve dare \"€ -1,50\"; parseCsv non gestisce i campi tra virgolette con virgole (BK0057 in data/books.csv); slugify(\"Perché è così\") deve dare \"perche-e-cosi\"; paginate pagina 1 = primi elementi. npm test deve passare.",
	tasks: [
		{ id: "t1", role: "implementer", title: "inventory e paginazione", instructions: "Correggi src/inventory.js (totalValue deve moltiplicare per la quantità) e src/pagination.js (la pagina 1 deve restituire i primi elementi). Aggiungi un test per ognuno.", files: ["src/inventory.js", "src/pagination.js", "test/inventory.test.js", "test/pagination.test.js"] },
		{ id: "t2", role: "implementer", title: "formato e csv", instructions: "Correggi src/format.js (formatPrice(-150) = \"€ -1,50\"; slugify(\"Perché è così\") = \"perche-e-cosi\") e src/csv.js (campi tra virgolette con virgole, vedi BK0057 in data/books.csv). Aggiungi un test per ognuno.", files: ["src/format.js", "src/csv.js", "test/format.test.js", "test/csv.test.js"] },
	],
	verify: ["npm test"],
};

const sh = (cwd, command) => { try { return { out: execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }) }; } catch (error) { return { out: `${error.stdout ?? ""}${error.stderr ?? ""}` }; } };
const check = cases.find((testCase) => testCase.id === "tc01").check;

for (let round = 1; round <= rounds; round++) {
	for (const arm of round % 2 ? ["crm", "free"] : ["free", "crm"]) {
		const directory = join(homedir(), ".cache/pi-eval/work", runName, `${arm}-${round}`);
		rmSync(directory, { recursive: true, force: true });
		execSync(`node ${JSON.stringify(join(here, "fixture/build.mjs"))} ${JSON.stringify(directory)}`);
		if (arm === "free") process.env.PI_TEAM_CRM = "0"; else delete process.env.PI_TEAM_CRM;
		const traces = [];
		const usage = { input: 0, output: 0, requests: 0, agentRuns: 0, outChars: 0 };
		const started = Date.now();
		const report = await runTeamPlan(structuredClone(plan), {
			roles: loadRoles(), cwd: directory, concurrency: 1, runVerify: runVerifyCommands,
			runAgent: async (request) => {
				const trace = [];
				const run = await runAgent({ ...request, onEvent: (event) => {
					if (event.type === "tool_execution_start") trace.push({ tool: event.toolName, args: JSON.stringify(event.args ?? {}).slice(0, 160) });
					if (event.type === "message_end" && event.message?.role === "assistant") trace.push({ turn: "assistant", out: event.message.usage?.output, in: (event.message.usage?.input ?? 0) + (event.message.usage?.cacheRead ?? 0) + (event.message.usage?.cacheWrite ?? 0) });
				} });
				traces.push({ role: request.role.name, seconds: run.seconds, in: run.inputTokens, out: run.outputTokens, prompt: request.prompt.length, trace, text: run.text.slice(-400) });
				usage.input += run.inputTokens; usage.output += run.outputTokens; usage.requests += run.requests; usage.agentRuns++; usage.outChars += run.text.length;
				return run;
			},
		});
		const verdict = check({ js: (code) => sh(directory, `node --input-type=module -e ${JSON.stringify(code)}`).out.trim(), sh: (command) => sh(directory, command) });
		const record = { arm, round, pass: verdict.pass, detail: verdict.detail, seconds: Math.round((Date.now() - started) / 100) / 10, outcome: report.outcome, ...usage, attempts: report.tasks.reduce((sum, task) => sum + task.attempts, 0), summaryChars: report.tasks.reduce((sum, task) => sum + (task.summary?.length ?? 0), 0) };
		writeFileSync(join(here, "results", `${runName}-${arm}-${round}.trace.json`), JSON.stringify(traces, null, 1));
		appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
		console.log(JSON.stringify(record));
	}
}
