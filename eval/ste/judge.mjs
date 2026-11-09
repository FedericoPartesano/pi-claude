// Blind pairwise judge over eval/ste/results.json: which answer is clearer and more correct. A/B order is random per pair.
// Usage: node eval/ste/judge.mjs [judge model]. Writes eval/ste/judge.json.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
const run = promisify(execFile);
const model = process.argv[2] ?? "sonnet";
const rows = JSON.parse(readFileSync(new URL("results.json", import.meta.url), "utf8"));
const QUESTIONS = [...new Set(rows.map((r) => r.q))];
const ask = (q) => ["How do I find which process listens on port 8080 on Linux, and how do I stop it?","Explain the difference between a mutex and a semaphore.","A Node.js script leaks memory. How do I find the cause?","How do I undo the last git commit but keep the changes?","What is the difference between TCP and UDP and when do I use each one?","How do I rotate a log file safely with logrotate?","Why does my Docker container exit immediately, and how do I debug it?","How do I add an index to a slow PostgreSQL query and check that it helps?"][q];
const PAIRS = [["plain", "ste"], ["plain", "combo"], ["caveman", "combo"]];
const jobs = [];
for (const [x, y] of PAIRS) for (const q of QUESTIONS) jobs.push({ x, y, q, swap: Math.random() < 0.5 });
const text = (style, q) => rows.find((r) => r.style === style && r.q === q).text;
const results = [];
await Promise.all([0, 1, 2, 3].map(async (lane) => {
	for (let i = lane; i < jobs.length; i += 4) {
		const { x, y, q, swap } = jobs[i];
		const [a, b] = swap ? [y, x] : [x, y];
		const prompt = `Question: ${ask(q)}\n\nAnswer A:\n${text(a, q)}\n\nAnswer B:\n${text(b, q)}\n\nYou are a strict technical reviewer. Which answer is better for a developer who must act on it: clearer, technically correct, complete enough? Ignore length by itself. Reply with ONLY a JSON object: {"winner":"A"|"B"|"tie","clarity_a":1-5,"clarity_b":1-5,"correct_a":1-5,"correct_b":1-5,"reason":"one sentence"}`;
		const args = ["-p", prompt, "--model", model, "--output-format", "json", "--tools", "", "--setting-sources", ""];
		let out; try { out = await run("claude", args, { timeout: 120_000, cwd: "/tmp/ste-cwd" }); } catch { out = await run("claude", args, { timeout: 120_000, cwd: "/tmp/ste-cwd" }); }
		const raw = JSON.parse(out.stdout).result;
		const v = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
		const pick = v.winner === "tie" ? "tie" : (v.winner === "A" ? a : b);
		const sc = (st) => (st === a ? { c: v.clarity_a, k: v.correct_a } : { c: v.clarity_b, k: v.correct_b });
		results.push({ x, y, q, a, b, winner: pick, [x]: sc(x), [y]: sc(y), reason: v.reason });
		console.error(x, y, q, pick);
	}
}));
writeFileSync(new URL("judge.json", import.meta.url), JSON.stringify(results, null, 1));
for (const [x, y] of PAIRS) {
	const r = results.filter((z) => z.x === x && z.y === y);
	const m = (st, k) => (r.reduce((s, z) => s + z[st][k], 0) / r.length).toFixed(2);
	console.log(`${x} vs ${y}: ${x} ${r.filter((z) => z.winner === x).length} | ${y} ${r.filter((z) => z.winner === y).length} | tie ${r.filter((z) => z.winner === "tie").length} | chiarezza ${m(x, "c")} / ${m(y, "c")} | correttezza ${m(x, "k")} / ${m(y, "k")}`);
}
