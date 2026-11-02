#!/usr/bin/env node
// Compares the team with the CRM callout protocol (harness pi-team) and without it (pi-team-free).
// Usage: node team-crm-analyze.mjs results/<run>.jsonl [more.jsonl ...]
import { readFileSync } from "node:fs";

const rows = process.argv.slice(2).flatMap((file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
const report = (row) => row.turns.map((turn) => turn.teamReport ?? "").join("\n");
const sum = (values) => values.reduce((a, b) => a + b, 0);
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

const stats = (harness) => {
	const group = rows.filter((row) => row.harness === harness);
	const attempts = group.map((row) => sum([...report(row).matchAll(/tentativi (\d+)/g)].map((m) => Number(m[1]))));
	return {
		harness,
		runs: group.length,
		pass: group.filter((row) => row.pass).length,
		teamVerified: group.filter((row) => /VERIFICATO/.test(row.teamOutcome ?? "")).length,
		// Attempts beyond one per task: how often the manager had to resend a task.
		retries: sum(group.map((row, i) => Math.max(0, attempts[i] - row.teamTasks))),
		blocked: sum(group.map((row) => (report(row).match(/\((bloccato|in disaccordo):/g) ?? []).length)),
		deviations: sum(group.map((row) => (report(row).match(/⚠ Deviazione/g) ?? []).length)),
		medianSeconds: median(group.map((row) => row.seconds)),
		medianOutput: median(group.map((row) => row.outputTokens)),
		medianInput: median(group.map((row) => row.inputTokens)),
		totalOutput: sum(group.map((row) => row.outputTokens)),
		errors: sum(group.map((row) => row.errors.length)),
		byCase: Object.fromEntries(group.map((row) => [`${row.case}`, [row.pass ? "ok" : "KO", row.seconds + "s", row.outputTokens + "out"].join(" ")])),
	};
};

const arms = ["pi-team", "pi-team-free"].map(stats).filter((arm) => arm.runs);
console.log("| Braccio | Run | Pass | Team verificato | Retry | Bloccati | Deviazioni | Tempo med. | Output med. | Input med. | Errori |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const arm of arms) {
	const name = arm.harness === "pi-team" ? "CRM (callout)" : "libero (controllo)";
	console.log(`| ${name} | ${arm.runs} | ${arm.pass}/${arm.runs} | ${arm.teamVerified}/${arm.runs} | ${arm.retries} | ${arm.blocked} | ${arm.deviations} | ${arm.medianSeconds} s | ${arm.medianOutput} | ${arm.medianInput} | ${arm.errors} |`);
}
console.log("\nPer caso:");
for (const arm of arms) console.log(`- ${arm.harness}: ${JSON.stringify(arm.byCase)}`);
