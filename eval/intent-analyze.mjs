#!/usr/bin/env node
// Summarizes an intent evaluation run: node intent-analyze.mjs <run> (reads results/<run>.jsonl).
import { readFileSync } from "node:fs";

const run = process.argv[2];
if (!run) throw new Error("uso: node intent-analyze.mjs <run>");
const records = readFileSync(new URL(`results/${run}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((line) => JSON.parse(line));

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const k = (value) => `${(value / 1000).toFixed(1)}k`;
const percent = (part, whole) => `${whole ? Math.round((100 * part) / whole) : 0}%`;

const summarize = (rows) => ({
	jobs: rows.length,
	met: percent(rows.reduce((sum, row) => sum + row.met, 0), rows.reduce((sum, row) => sum + row.total, 0)),
	metNoApi: percent(rows.reduce((sum, row) => sum + (row.metNoApi ?? 0), 0), rows.reduce((sum, row) => sum + (row.totalNoApi ?? 0), 0)),
	pass: `${rows.filter((row) => row.pass).length}/${rows.length}`,
	seconds: `${mean(rows.map((row) => row.seconds)).toFixed(0)} s`,
	input: k(mean(rows.map((row) => row.inputTokens))),
	output: k(mean(rows.map((row) => row.outputTokens))),
	sim: k(mean(rows.map((row) => row.simInputTokens + row.simOutputTokens))),
	questions: mean(rows.map((row) => row.questions)).toFixed(1),
	touchedTests: rows.filter((row) => row.touchedPreexistingTests?.length).length,
	errors: rows.reduce((sum, row) => sum + row.errors.length + row.timeouts, 0),
});

const table = (title, groups) => {
	console.log(`\n## ${title}\n`);
	console.log("| | job | requisiti | requisiti senza API | tutti ok | tempo medio | input medio | output medio | utente sim. | domande | file di test preesistenti modificati (anche solo aggiunte) | errori |");
	console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (const [name, rows] of groups) {
		const s = summarize(rows);
		console.log(`| ${name} | ${s.jobs} | ${s.met} | ${s.metNoApi} | ${s.pass} | ${s.seconds} | ${s.input} | ${s.output} | ${s.sim} | ${s.questions} | ${s.touchedTests} | ${s.errors} |`);
	}
};

const byArm = (rows) => [...new Set(rows.map((row) => row.arm))].sort().map((arm) => [arm, rows.filter((row) => row.arm === arm)]);
table(`Per braccio (${run})`, byArm(records));
for (const id of [...new Set(records.map((row) => row.case))].sort()) table(`Caso ${id}`, byArm(records.filter((row) => row.case === id)));
