// Score a haystack run (eval/fold/long.py on the scenario of gen.py). usage: node score.mjs <run dir> <truth.json>
// Prints one JSON line: tokens, live context, compactions, bridge restarts, context-tool calls (overall and during each
// quiz) and, per quiz, which questions were answered right, wrong, stale (a superseded value) or wrongly abstained.
import { readFileSync } from "node:fs";
const [dir, truthPath] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const abstain = new RegExp(truth.abstain, "i");
const events = readFileSync(`${dir}/events.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let req = 0, input = 0, cacheRead = 0, cacheWrite = 0, output = 0, maxCtx = 0, text = "", turn = 0, wc = null;
const turnText = [], tools = {}, turnTools = [], other = {};
let current = {};
for (const e of events) {
	if (e.type === "message_end" && e.message?.role === "assistant") {
		const u = e.message.usage ?? {};
		req++; input += u.input ?? 0; cacheRead += u.cacheRead ?? 0; cacheWrite += u.cacheWrite ?? 0; output += u.output ?? 0;
		maxCtx = Math.max(maxCtx, (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0));
		text += (e.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
	}
	if (e.type === "tool_execution_start") {
		tools[e.toolName] = (tools[e.toolName] ?? 0) + 1;
		current[e.toolName] = (current[e.toolName] ?? 0) + 1;
	}
	if (/compact/i.test(e.type)) other[e.type] = (other[e.type] ?? 0) + 1;
	if (e.type === "agent_settled") { turnText[++turn] = text; turnTools[turn] = current; text = ""; current = {}; }
}
// The assistant's own proposal: the first word of its answer at that turn.
const proposed = (turnText[truth.assistantTurn] ?? "").replace(/[*_`"«»]/g, "").match(/[A-Za-zÀ-ÿ][\wÀ-ÿ-]+/)?.[0] ?? "\u0000";
const quizTurns = turnText.map((t, i) => (/RISPOSTE:?[\s*]*1[).]/i.test(t ?? "") ? i : 0)).filter(Boolean);
const quizzes = truth.quizzes.map((qs, k) => {
	const n = quizTurns[k], a = turnText[n] ?? "";
	const result = qs.map((q, i) => {
		const part = a.split(new RegExp(`(?:^|\\n)\\s*\\**${i + 1}[).]`))[1]?.split(new RegExp(`\\n\\s*\\**${i + 2}[).]`))[0] ?? "";
		const said = abstain.test(part);
		if (q.re === "ABSTAIN") return [q.name, q.kind, said ? "ok" : "invented"];
		const re = q.re.startsWith("ASSISTANT:") ? new RegExp(`\\b${proposed}\\b`, "i") : new RegExp(q.re, "i");
		if (re.test(part) && !said) return [q.name, q.kind, "ok"];
		if (q.old && new RegExp(q.old, "i").test(part)) return [q.name, q.kind, "stale"];
		return [q.name, q.kind, said ? "abstained" : "wrong"];
	});
	return {
		turn: n, tools: turnTools[n] ?? {}, score: `${result.filter((r) => r[2] === "ok").length}/${qs.length}`,
		missed: result.filter((r) => r[2] !== "ok").map((r) => `${r[0]}:${r[2]}`),
	};
});
const spawns = readFileSync(`${dir}/spawns.log`, "utf8").split("\n").filter(Boolean);
const turns = readFileSync(`${dir}/turns.tsv`, "utf8").split("\n").filter(Boolean).map((l) => Number(l.split("\t")[1]));
console.log(JSON.stringify({
	turns: turns.length, seconds: Math.round(turns.reduce((s, t) => s + t, 0)), req, input, cacheRead, cacheWrite, output,
	totalIn: input + cacheRead + cacheWrite, weighted: Math.round(input + 0.1 * cacheRead + 1.25 * cacheWrite + 5 * output),
	maxCtx, tools, compaction: other, spawns: spawns.length, resumes: spawns.filter((s) => s.includes("--resume")).length,
	proposed, quizzes,
}));
