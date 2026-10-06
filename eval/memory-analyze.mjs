#!/usr/bin/env node
// Tables for a memory evaluation run: rule compliance per arm and per rule, tokens, /dream cost, memory checks.
// Usage: node memory-analyze.mjs <run>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RULES } from "./memory-sessions.mjs";

const run = process.argv[2];
if (!run) throw new Error("uso: node memory-analyze.mjs <run>");
const rows = readFileSync(join(new URL(".", import.meta.url).pathname, "results", `${run}.jsonl`), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const arms = [...new Set(rows.map((row) => row.arm))];
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const k = (value) => `${(value / 1000).toFixed(1)}k`;
const compliance = (list, rule) => {
	const statuses = list.flatMap((row) => (rule ? [row.rules[rule]] : Object.values(row.rules))).filter((status) => status && status !== "na");
	const ok = statuses.filter((status) => status === "ok").length;
	return statuses.length ? `${ok}/${statuses.length} (${Math.round((ok / statuses.length) * 100)}%)` : "—";
};

const taskRows = rows.filter((row) => row.task !== "probe");
console.log(`## Per braccio (${run})\n`);
console.log("| Braccio | Job | Regole rispettate | Input medio/job | Output medio/job | Richieste/job | Costo /dream (in+out) | Errori |");
console.log("|---|---|---|---|---|---|---|---|");
for (const arm of arms) {
	const list = taskRows.filter((row) => row.arm === arm);
	const dreams = list.filter((row) => row.dream);
	console.log(`| ${arm} | ${list.length} | ${compliance(list)} | ${k(average(list.map((row) => row.inputTokens)))} | ${k(average(list.map((row) => row.outputTokens)))} | ${average(list.map((row) => row.requests)).toFixed(1)} | ${dreams.length ? `${k(average(dreams.map((row) => row.dream.inputTokens)))}+${k(average(dreams.map((row) => row.dream.outputTokens)))}` : "—"} | ${list.filter((row) => row.errors.length).length} |`);
}

console.log("\n## Per regola\n");
console.log(`| Regola | ${arms.join(" | ")} |`);
console.log(`|---|${arms.map(() => "---").join("|")}|`);
for (const [rule, text] of Object.entries(RULES)) console.log(`| ${rule} ${text} | ${arms.map((arm) => compliance(taskRows.filter((row) => row.arm === arm), rule)).join(" | ")} |`);

const probes = rows.filter((row) => row.task === "probe");
if (probes.length) {
	console.log("\n## Overhead per richiesta (\"Rispondi solo: ok\")\n");
	for (const arm of arms) {
		const list = probes.filter((row) => row.arm === arm);
		if (list.length) console.log(`- ${arm}: ${Math.round(average(list.map((row) => row.inputTokens)))} token in input`);
	}
}

const memories = rows.filter((row) => row.memory);
if (memories.length) {
	console.log("\n## Consolidamento (/dream)\n");
	const yes = (predicate) => `${memories.filter(predicate).length}/${memories.length}`;
	console.log(`- memory.md creato: ${yes((row) => row.memory.exists)}`);
	console.log(`- segreto finto finito in memoria: ${yes((row) => row.memory.secretLeaked)} (atteso 0)`);
	console.log(`- regola test aggiornata (.spec.js) presente: ${yes((row) => row.memory.recentTestRule)}; regola vecchia tests/ ancora attiva: ${yes((row) => row.memory.staleTestRuleActive)} (atteso 0)`);
	console.log(`- dimensione media: ${Math.round(average(memories.filter((row) => row.memory.exists).map((row) => row.memory.chars)))} caratteri (tetto 3.600), ${average(memories.filter((row) => row.memory.exists).map((row) => row.memory.entries)).toFixed(1)} voci`);
	for (const rule of Object.keys(RULES)) console.log(`- ${rule} citata in memoria: ${yes((row) => row.memory.rulesMentioned?.[rule])}`);
}
