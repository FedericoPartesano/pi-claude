// Summarise a pi --mode json run: per-request usage, tool calls, compactions, final answer.
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const lines = readFileSync(`${dir}/events.jsonl`, "utf8").split("\n").filter(Boolean);
let req = 0, input = 0, cacheRead = 0, cacheWrite = 0, output = 0, maxCtx = 0, last = "";
const tools = {}, other = {};
for (const l of lines) {
	let e; try { e = JSON.parse(l); } catch { continue; }
	if (e.type === "message_end" && e.message?.role === "assistant") {
		const u = e.message.usage ?? {};
		req++; input += u.input ?? 0; cacheRead += u.cacheRead ?? 0; cacheWrite += u.cacheWrite ?? 0; output += u.output ?? 0;
		maxCtx = Math.max(maxCtx, (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0));
		const t = (e.message.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
		if (t) last = t;
	}
	if (e.type === "tool_execution_start") tools[e.toolName] = (tools[e.toolName] ?? 0) + 1;
	if (/compact/i.test(e.type)) other[e.type] = (other[e.type] ?? 0) + 1;
}
const spawns = readFileSync(`${dir}/spawns.log`, "utf8").split("\n").filter(Boolean);
console.log(JSON.stringify({ req, input, cacheRead, cacheWrite, output, totalIn: input + cacheRead + cacheWrite, maxCtx, hit: +(cacheRead / (input + cacheRead + cacheWrite)).toFixed(3), tools, compaction: other, spawns: spawns.length, resumes: spawns.filter((s) => s.includes("--resume")).length }));
console.log("--- finale:\n" + last.slice(-900));
