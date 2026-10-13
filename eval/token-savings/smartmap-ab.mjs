// A/B Pi base vs Pi + project-map sul repo grande smartlookup-mono (sola lettura, risposte verificabili).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { PiHarness } from "../harness.mjs";
const repo = "/home/fede/ClaudeWorkAssistant/ISAB/repos/smartlookup-mono";
const qs = JSON.parse(readFileSync("/tmp/cav-run/smart-q.json", "utf8"));
const ext = new URL("../../extensions/project-map.ts", import.meta.url).pathname;
const jobs = qs.flatMap((q) => ["base", "map"].map((mode) => ({ q, mode })));
const out = join(import.meta.dirname, "results"); mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: 2 }, async () => {
	while (jobs.length) {
		const { q, mode } = jobs.shift();
		const agent = new PiHarness(repo, "sonnet", undefined, { extraArgs: mode === "map" ? ["-e", ext] : [] });
		const t = await agent.runTurn(q.prompt + " Sola lettura: non modificare nulla."); agent.close();
		const u = t.usage; const cost = u.cacheRead * 0.1 + u.cacheWrite * 1.25 + u.input + u.output * 5;
		const pass = /^\d+$/.test(q.expect) ? new RegExp(`\\b${q.expect}\\b`).test(t.answer) : t.answer.includes(basename(q.expect)) && t.answer.includes(q.expect.split("/").slice(0, 2).join("/"));
		const rec = { case: q.id, mode, pass, seconds: t.seconds, requests: t.requests, cost, answer: t.answer.slice(0, 160) };
		appendFileSync(join(out, "smartmap-ab.jsonl"), JSON.stringify(rec) + "\n");
		console.log(pass ? "PASS" : "FAIL", q.id, mode, `req=${rec.requests} cost=${Math.round(cost)} ${rec.seconds}s`);
	}
}));
