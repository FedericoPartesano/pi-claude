// Score a long-chat run (eval/fold/long.py): tokens, live context, Pi compactions, latency, and the two final recall
// answers (before and after the restart) against the true values. usage: node eval/fold/long-check.mjs <run dir>
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const events = readFileSync(`${dir}/events.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
// Each fact: a regex the answer must match (separators and case relaxed).
const truth = [
	["ticket", /PIC-?2291/i], ["revisore", /Giulia Ferraris/i], ["scadenza", /4 dicembre/i], ["porta", /7342/],
	["bridge", /non si tocca|non (va |deve essere )?toccat|intoccabil|non modificar/i], ["rilascio", /Aurora Boreale/i],
	// The line count changes with the sources: the truth is what `wc -l` printed in this run.
	["righe bash", null], ["FADE_DAYS", /\b60\b/], ["POWERSHELL", /\/mnt\/c\/Windows\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe/],
	["QUADRO_CHARS", /\b1\.?200\b/], ["LOOKBACK_CHARS", /60[_.,]?000/], ["vault model", /multilingual-e5-small/i],
	["PANEL_WIDTH", /\b40\b/], ["WHEN_TIMEOUT_MS", /5\s*\*\s*60[_,.]?000|300[_.,]?000|5 minut/i],
];
let wcTotal = "14403", req = 0, input = 0, cacheRead = 0, cacheWrite = 0, output = 0, maxCtx = 0, text = "";
const answers = [], tools = {}, other = {};
for (const e of events) {
	if (e.type === "message_end" && e.message?.role === "assistant") {
		const u = e.message.usage ?? {};
		req++; input += u.input ?? 0; cacheRead += u.cacheRead ?? 0; cacheWrite += u.cacheWrite ?? 0; output += u.output ?? 0;
		maxCtx = Math.max(maxCtx, (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0));
		text += (e.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
	}
	if (e.type === "tool_execution_end" && e.toolName === "bash") {
		const total = JSON.stringify(e.result ?? "").match(/(\d+) total/);
		if (total) wcTotal = total[1];
	}
	if (e.type === "tool_execution_start") tools[e.toolName] = (tools[e.toolName] ?? 0) + 1;
	if (/compact/i.test(e.type)) other[e.type] = (other[e.type] ?? 0) + 1;
	if (e.type === "agent_settled") { if (/RISPOSTE:?[\s*]*1[).]/i.test(text)) answers.push(text); text = ""; }
}
// Each answer is split by its "N)" markers so that a value is only credited to its own question.
const score = (a) => truth.map(([name, re], i) => {
	const part = a.split(new RegExp(`(?:^|\\n)\\s*\\**${i + 1}[).]`))[1]?.split(new RegExp(`\\n\\s*\\**${i + 2}[).]`))[0] ?? "";
	// "non so (40 was a guess)" is a miss: the value only counts when the model does not disown it.
	return [name, !/\bnon so\b|non (lo )?ricordo|not known/i.test(part) && (re ?? new RegExp(`\\b${wcTotal.replace(/\B(?=(\d{3})+$)/g, "[.,]?")}\\b`)).test(part)];
});
const turns = readFileSync(`${dir}/turns.tsv`, "utf8").split("\n").filter(Boolean).map((l) => Number(l.split("\t")[1]));
const spawns = readFileSync(`${dir}/spawns.log`, "utf8").split("\n").filter(Boolean);
const scored = answers.map(score);
console.log(JSON.stringify({
	turns: turns.length, seconds: Math.round(turns.reduce((s, t) => s + t, 0)), p90turn: [...turns].sort((a, b) => a - b)[Math.floor(turns.length * 0.9)],
	req, input, cacheRead, cacheWrite, output, totalIn: input + cacheRead + cacheWrite,
	weighted: Math.round(input + 0.1 * cacheRead + 1.25 * cacheWrite + 5 * output), maxCtx, tools, compaction: other,
	spawns: spawns.length, resumes: spawns.filter((s) => s.includes("--resume")).length,
	recall: scored.map((s) => `${s.filter(([, ok]) => ok).length}/${truth.length}`),
	missed: scored.map((s) => s.filter(([, ok]) => !ok).map(([n]) => n)),
}));
