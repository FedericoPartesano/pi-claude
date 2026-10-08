#!/usr/bin/env node
// Round-2 report: tasks solved, cost and memory compliance per harness → eval/REPORT-2.md.
// Usage: node analyze.mjs <tasksRun> <memoryRun>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function summarizeTasks(records) {
	const out = {};
	const solved = {};
	for (const record of records) {
		const entry = (out[record.harness] ??= { runs: 0, passed: 0, solvedTasks: 0, totalTasks: 0, inputTokens: 0, outputTokens: 0, seconds: 0, requests: 0 });
		const tasks = (solved[record.harness] ??= new Map());
		entry.runs++;
		if (record.pass) entry.passed++;
		entry.inputTokens += record.inputTokens;
		entry.outputTokens += record.outputTokens;
		entry.seconds += record.seconds;
		entry.requests += record.requests;
		tasks.set(record.task, (tasks.get(record.task) ?? false) || record.pass);
	}
	for (const [harness, tasks] of Object.entries(solved)) {
		out[harness].totalTasks = tasks.size;
		out[harness].solvedTasks = [...tasks.values()].filter(Boolean).length;
	}
	return out;
}

/**
 * The records the comparison may use: contaminated runs (a way to the fix in the transcript) out, then only the
 * task × attempt keys that every harness completed, so a run stopped midway does not compare unequal sets.
 */
export function comparable(records) {
	const clean = records.filter((record) => !record.contaminated);
	const harnesses = [...new Set(records.map((record) => record.harness))];
	const slot = (record) => `${record.task}|${record.attempt}`;
	const complete = new Set([...new Set(clean.map(slot))].filter((key) => harnesses.every((harness) => clean.some((record) => slot(record) === key && record.harness === harness))));
	const kept = clean.filter((record) => complete.has(slot(record)));
	return { kept, contaminated: records.length - clean.length, unmatched: clean.length - kept.length };
}

/** Compliance = ok / (ok + violated): rules that do not apply to a change do not count. */
export function summarizeMemory(records) {
	const out = {};
	for (const record of records) {
		if (record.type === "setup" || !record.rules) continue;
		const entry = (out[`${record.arm}|${record.harness}`] ??= { ok: 0, violated: 0, compliance: 0 });
		for (const state of Object.values(record.rules)) {
			if (state === "ok") entry.ok++;
			else if (state === "violated") entry.violated++;
		}
		entry.compliance = entry.ok + entry.violated ? entry.ok / (entry.ok + entry.violated) : 0;
	}
	return out;
}

/** With 20 tasks × 2 runs a gap of 2 solved tasks or less is noise. */
export const verdict = (pi, claude) => (Math.abs(pi - claude) <= 2 ? "alla pari" : pi > claude ? "più bravo" : "meno bravo");

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
	const [tasksRun, memoryRun] = process.argv.slice(2);
	const evalDir = new URL(".", import.meta.url).pathname;
	const read = (name) => (name ? readFileSync(join(evalDir, "../results", `${name}.jsonl`), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
	const allTaskRecords = read(tasksRun);
	const { kept: taskRecords, contaminated, unmatched } = comparable(allTaskRecords);
	const memoryRecords = read(memoryRun);
	const tasks = summarizeTasks(taskRecords);
	const memory = summarizeMemory(memoryRecords);
	const k = (n) => `${Math.round(n / 1000)}k`;
	const lines = [
		"# Pi vs Claude Code, giro 2: compiti difficili e memoria (Opus, effort high)",
		"",
		`Run compiti: \`${tasksRun}\` · run memoria: \`${memoryRun ?? "—"}\` · spec: \`docs/specs/2026-10-08-eval-round2-design.md\``,
		"",
		"## Compiti difficili",
		"",
		`Confrontate solo le coppie compito × tentativo completate da entrambi. Esclusi: ${contaminated} esecuzioni contaminate (accesso alla correzione nella trascrizione), ${unmatched} senza la controparte.`,
		"",
		"| Harness | Esecuzioni passate | Compiti risolti (≥1 su 2) | Token in | Token out | Tempo | Richieste |",
		"|---|---|---|---|---|---|---|",
		...Object.entries(tasks).map(([harness, s]) => `| ${harness} | ${s.passed}/${s.runs} | ${s.solvedTasks}/${s.totalTasks} | ${k(s.inputTokens)} | ${k(s.outputTokens)} | ${Math.round(s.seconds / 60)} min | ${s.requests} |`),
		"",
		tasks["pi-full"] && tasks["claude-code"] ? `**Verdetto sui compiti: Pi è ${verdict(tasks["pi-full"].solvedTasks, tasks["claude-code"].solvedTasks)}** rispetto a Claude Code (differenze di 2 compiti o meno sono rumore con 20 compiti × 2).` : "",
		"",
		"## Memoria",
		"",
		"| Braccio | Harness | Regole rispettate | Conformità |",
		"|---|---|---|---|",
		...Object.entries(memory).map(([key, s]) => `| ${key.split("|")[0]} | ${key.split("|")[1]} | ${s.ok}/${s.ok + s.violated} | ${Math.round(s.compliance * 100)}% |`),
		"",
		"## Caso per caso",
		"",
		"| Compito | Harness | Tentativo | Esito | Motivo | Secondi | Token in |",
		"|---|---|---|---|---|---|---|",
		...taskRecords.map((r) => `| ${r.task} | ${r.harness} | ${r.attempt} | ${r.pass ? "✅" : "❌"} | ${r.reason} | ${r.seconds} | ${k(r.inputTokens)} |`),
		"",
		"## Analisi",
		"",
		"(Da scrivere a mano dopo aver letto i log: perché ognuno ha fallito dove ha fallito, e la risposta \"Pi è più intelligente sì/no/dove\".)",
		"",
		"Note di metodo da riportare: il conteggio dei token in uscita di Claude Code nel giro 1 era sottostimato (usava i parziali dello streaming); durante la costruzione di questo giro è stato corretto un bug di /dream di Pi (tipi di memoria sinonimi), senza un intervento equivalente su Claude Code; 12 compiti yaml e 8 marked (marked non ne dava di più validi).",
		"",
	];
	writeFileSync(join(evalDir, "../REPORT-2.md"), lines.join("\n"));
	console.log(lines.slice(4, 18).join("\n"));
}
