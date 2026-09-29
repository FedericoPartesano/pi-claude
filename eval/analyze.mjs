#!/usr/bin/env node
// Aggregates results/<run>.jsonl and scans the Pi bridge logs for anomalies.
// Usage: node analyze.mjs <run>   → prints markdown sections to stdout.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const run = process.argv[2] ?? "full";
const evalDirectory = new URL(".", import.meta.url).pathname;
const records = readFileSync(join(evalDirectory, "results", `${run}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));

const harnesses = ["claude-code", "pi"];
const categories = [...new Set(records.map((record) => record.category))];
const sum = (list, field) => list.reduce((total, record) => total + (record[field] ?? 0), 0);
const median = (values) => {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const format = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)));

console.log("## Riepilogo\n");
console.log("| Harness | Pass | Tempo tot. | Tempo mediano/caso | Richieste | Input token | Output token | Errori | Timeout | Negazioni/dialoghi |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const harness of harnesses) {
	const list = records.filter((record) => record.harness === harness);
	console.log(`| ${harness} | ${list.filter((record) => record.pass).length}/${list.length} | ${Math.round(sum(list, "seconds") / 60)} min | ${median(list.map((record) => record.seconds))} s | ${sum(list, "requests")} | ${format(sum(list, "inputTokens"))} | ${format(sum(list, "outputTokens"))} | ${list.filter((record) => record.errors.length).length} | ${sum(list, "timeouts")} | ${sum(list, "denials")} |`);
}

console.log("\n## Per categoria\n");
console.log("| Categoria | Casi | Pass CC | Pass Pi | Tempo medio CC | Tempo medio Pi | Input medio CC | Input medio Pi |");
console.log("|---|---|---|---|---|---|---|---|");
for (const category of categories) {
	const of = (harness) => records.filter((record) => record.category === category && record.harness === harness);
	const cc = of("claude-code");
	const pi = of("pi");
	console.log(`| ${category} | ${cc.length} | ${cc.filter((record) => record.pass).length} | ${pi.filter((record) => record.pass).length} | ${(sum(cc, "seconds") / cc.length).toFixed(1)} s | ${(sum(pi, "seconds") / pi.length).toFixed(1)} s | ${format(sum(cc, "inputTokens") / cc.length)} | ${format(sum(pi, "inputTokens") / pi.length)} |`);
}

console.log("\n## Caso per caso\n");
console.log("| Caso | CC | Pi | Tempo CC / Pi | Input CC / Pi | Dettaglio CC | Dettaglio Pi |");
console.log("|---|---|---|---|---|---|---|");
for (const caseId of [...new Set(records.map((record) => record.case))]) {
	const cc = records.find((record) => record.case === caseId && record.harness === "claude-code");
	const pi = records.find((record) => record.case === caseId && record.harness === "pi");
	const mark = (record) => (!record ? "—" : record.pass ? "✅" : "❌");
	const clean = (text) => String(text ?? "").replace(/\|/g, "/").slice(0, 70);
	console.log(`| ${caseId} | ${mark(cc)} | ${mark(pi)} | ${cc?.seconds ?? "—"} / ${pi?.seconds ?? "—"} s | ${format(cc?.inputTokens ?? 0)} / ${format(pi?.inputTokens ?? 0)} | ${clean(cc?.detail)} | ${clean(pi?.detail)} |`);
}

console.log("\n## Errori riportati dagli harness\n");
for (const record of records.filter((record) => record.errors.length || record.timeouts)) {
	console.log(`- **${record.case} ${record.harness}**: ${record.timeouts ? `${record.timeouts} timeout; ` : ""}${record.errors.map((error) => error.slice(0, 160)).join(" · ")}`);
}

console.log("\n## Uso dei tool (totale)\n");
for (const harness of harnesses) {
	const counts = {};
	for (const record of records.filter((record) => record.harness === harness)) for (const tool of record.tools) counts[tool] = (counts[tool] ?? 0) + 1;
	console.log(`- ${harness}: ${Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([tool, count]) => `${tool} ${count}`).join(", ")}`);
}

const logDirectory = join(evalDirectory, "logs", run);
if (existsSync(logDirectory)) {
	console.log("\n## Anomalie nei log del bridge (Pi)\n");
	const patterns = {
		"spawn di claude": / spawn /,
		"resume nativo": /"--resume"/,
		"riuso processo": /reuse=yes/,
		"chiamate MCP non attese": /unmatched MCP call/,
		"sessioni terminate con errore": /session ended: (?!claude session disposed)/,
		"result con errore": /"is_error":true/,
		"tool result spostati su file (Claude Code)": /tool-results|Output too large|saved to/,
		"rate limit rifiutato": /"status":"rejected"|"status":"allowed_warning"/,
	};
	console.log("| Evento | Occorrenze | Casi |");
	console.log("|---|---|---|");
	const logs = readdirSync(logDirectory).map((file) => ({ file, text: readFileSync(join(logDirectory, file), "utf8") }));
	for (const [label, pattern] of Object.entries(patterns)) {
		const hits = logs.map(({ file, text }) => ({ file: file.replace("-pi.log", ""), count: text.split("\n").filter((line) => pattern.test(line)).length })).filter((hit) => hit.count > 0);
		console.log(`| ${label} | ${hits.reduce((total, hit) => total + hit.count, 0)} | ${hits.map((hit) => `${hit.file}(${hit.count})`).join(" ").slice(0, 160)} |`);
	}
}
