#!/usr/bin/env node
// Does the project graph help the model on multi-level dependency questions? Same question, Haiku, with the graph (tools + summary) and without (PI_GRAPH=0).
// Truth comes from eval/graph/truth.mjs (plain regex import graph). Runs in sequence. Usage:
//   node eval/graph/bench.mjs [--reps 2] [--only Q1,Q2] [--arms graph,nograph] [--model haiku] [--out results.jsonl]
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allFiles, chain, dependencies, dependents } from "./truth.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const reps = Number(arg("reps", "2"));
const only = arg("only", "").split(",").filter(Boolean);
const arms = arg("arms", "graph,nograph").split(",");
const model = arg("model", "haiku");
const outFile = arg("out", join(here, "results.jsonl"));
const root = join(here, "..", "..");

const RULE = "Rispondi solo con l'elenco dei percorsi dei file (uno per riga, percorso relativo alla radice del repo), senza spiegazioni. Non modificare nulla. ";
const QUESTIONS = [
	{ id: "Q1", prompt: `${RULE}Quali file dipendono, direttamente o indirettamente (tramite import a catena), da extensions/graph/progress.ts? Cioè quali file potrebbero rompersi se cambio la sua interfaccia? Includi anche i test.`, expected: [...dependents("extensions/graph/progress.ts")] },
	{ id: "Q2", prompt: `${RULE}Quali file dipendono, direttamente o indirettamente (tramite import a catena), da extensions/intent.ts? Includi anche test e script eval.`, expected: [...dependents("extensions/intent.ts")] },
	{ id: "Q3", prompt: `${RULE}Quali file dipendono, direttamente o indirettamente (tramite import a catena, anche import dinamici), da pi-ui/src/panel.ts? Includi anche i test.`, expected: [...dependents("pi-ui/src/panel.ts")] },
	{ id: "Q4", prompt: `${RULE}Quali file dipendono, direttamente o indirettamente (tramite import a catena), da extensions/bug/viewer.ts? Includi anche i test.`, expected: [...dependents("extensions/bug/viewer.ts")] },
	{ id: "Q5", prompt: `${RULE}Da quali file del repo dipende, direttamente o indirettamente (tramite import a catena), extensions/graph/graphify.ts? Escludi i moduli esterni (node:, npm).`, expected: [...dependencies("extensions/graph/graphify.ts")] },
];

const family = (id = "") => (/opus/i.test(id) ? "opus" : /sonnet/i.test(id) ? "sonnet" : "haiku");
const baseCount = new Map();
for (const f of allFiles) baseCount.set(f.split("/").pop(), (baseCount.get(f.split("/").pop()) ?? 0) + 1);

/** Which tracked files does the answer name? Full path, or bare name when it is unique in the repo. */
function mentioned(answer) {
	const found = new Set();
	for (const f of allFiles) {
		const base = f.split("/").pop();
		if (answer.includes(f) || (baseCount.get(base) === 1 && new RegExp(`(^|[^\\w./-])${base.replace(/\./g, "\\.")}(?![\\w])`).test(answer))) found.add(f);
	}
	return found;
}

function score(answer, expected, asked) {
	const got = mentioned(answer);
	const truth = new Set(expected);
	const hits = [...truth].filter((f) => got.has(f));
	const wrong = [...got].filter((f) => !truth.has(f) && f !== asked);
	return { recall: truth.size ? hits.length / truth.size : 1, precision: got.size ? hits.length / (hits.length + wrong.length) : 0, missing: [...truth].filter((f) => !got.has(f)), wrong };
}

function pi(prompt, env) {
	return new Promise((resolve) => {
		const child = spawn("pi", ["-p", "--mode", "json", "--no-session", "--provider", "claude-code", "--model", model, prompt], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (c) => (out += c));
		child.stderr.on("data", () => {});
		const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
		child.on("close", () => (clearTimeout(timer), resolve(out.split("\n"))));
	});
}

function parse(lines) {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const tools = {};
	let answer = "";
	for (const line of lines) {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "tool_execution_start") tools[event.toolName] = (tools[event.toolName] ?? 0) + 1;
		if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
		const u = event.message.usage ?? {};
		usage.input += u.input ?? 0;
		usage.output += u.output ?? 0;
		usage.cacheRead += u.cacheRead ?? 0;
		usage.cacheWrite += u.cacheWrite ?? 0;
		const textParts = (event.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
		if (textParts.length) answer = textParts.join("\n");
	}
	return { usage, tools, answer };
}

for (let rep = 1; rep <= reps; rep++) {
	for (const q of QUESTIONS) {
		if (only.length && !only.includes(q.id)) continue;
		for (const arm of arms) {
			const env = { ...process.env, PI_GRAPH: arm === "graph" ? "1" : "0", PI_ADVISOR: "0", PI_CLAUDE_ADVISOR: "off" };
			const started = Date.now();
			const { usage, tools, answer } = parse(await pi(q.prompt, env));
			const seconds = Math.round((Date.now() - started) / 1000);
			const s = score(answer, q.expected, q.prompt.match(/(?:da|di) ((?:[\w.-]+\/)+[\w.-]+\.\w+)/)?.[1]);
			const record = { q: q.id, arm, rep, seconds, usage, tools, expected: q.expected.length, recall: Number(s.recall.toFixed(2)), precision: Number(s.precision.toFixed(2)), missing: s.missing, wrong: s.wrong, answer: answer.slice(0, 1500) };
			appendFileSync(outFile, `${JSON.stringify(record)}\n`);
			console.log(`${q.id} ${arm} rep${rep}: ${seconds}s recall ${record.recall} precision ${record.precision} tools ${JSON.stringify(tools)} in ${usage.input + usage.cacheWrite}/cache ${usage.cacheRead}/out ${usage.output}`);
		}
	}
}
