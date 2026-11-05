// Sleep count with and without the `lancia` tool (extensions/jobs.ts). Same prompt, same script (a ~100 s job that prints
// a random code at the end); arm A = Pi as is (bash only), arm L = PI_JOBS=1. Measures bash calls with `sleep`, polling calls,
// requests, weighted cost (0,1/1,25/5 as eval/ab) and wall time, from the RPC event stream. Usage: node eval/jobs/run.mjs <A|L> <rep> [model] [job seconds, multiple of 20, default 100]
import { mkdirSync, writeFileSync } from "node:fs";
import { PiHarness } from "../harness.mjs";

const [arm, rep = "1", model = "haiku", duration = "100"] = process.argv.slice(2);
const steps = Math.max(1, Math.round(Number(duration) / 20));
if (!["A", "L"].includes(arm)) throw new Error("arm A or L");
const cwd = `/tmp/jobs-${duration}-${arm}-${rep}`;
mkdirSync(`${cwd}/.pi`, { recursive: true });
const code = Math.random().toString(16).slice(2, 8).toUpperCase();
writeFileSync(`${cwd}/slow.sh`, `#!/bin/bash\nfor i in $(seq 1 ${steps}); do echo "step $i/${steps} running"; sleep 20; done\necho "VERIFY-CODE ${code}"\n`);
const prompt = "Esegui `bash slow.sh` in questa cartella: è una verifica lunga (nel progetto vero dura più di 5 minuti, oltre il timeout dei comandi), quindi non aspettarla in primo piano. Quando finisce dimmi il VERIFY-CODE che stampa.";
const W = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 };

const h = new PiHarness(cwd, model, `${cwd}/debug.log`, { environment: arm === "L" ? { PI_JOBS: "1" } : {}, extraArgs: ["--approve"] });
const calls = [];
const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
let requests = 0, settles = 0, jobDone = false, answer = "";
const started = Date.now();
await new Promise((resolve) => {
	const timer = setTimeout(resolve, 600_000);
	h.process.listeners.add((record) => {
		if (record.type === "__exit__") return resolve();
		if (record.type === "message_end" && record.message?.role === "assistant") {
			requests++;
			for (const key of Object.keys(usage)) usage[key] += record.message.usage?.[key] ?? 0;
			const text = record.message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
			if (text) answer = text;
		}
		if (JSON.stringify(record).includes('"job-done"') && record.type === "message_end") jobDone = true;
		if (record.type === "tool_execution_start") calls.push({ tool: record.toolName, args: JSON.stringify(record.args ?? {}).slice(0, 160), at: Math.round((Date.now() - started) / 1000) });
		if (record.type === "agent_settled") {
			settles++;
			// arm L: the first settle can come before the job ends; wait for the job-done message and the turn it starts
			if (arm === "A" || jobDone || !calls.some((c) => c.tool === "lancia")) { clearTimeout(timer); resolve(); }
		}
	});
	h.process.send({ type: "prompt", message: prompt });
});
const seconds = Math.round((Date.now() - started) / 1000);
h.close();
const cost = Object.entries(W).reduce((sum, [key, weight]) => sum + usage[key] * weight, 0);
const sleeps = calls.filter((c) => c.tool === "bash" && /\bsleep\b/.test(c.args)).length;
const result = { arm, rep, model, duration: steps * 20, code, correct: answer.includes(code), sleeps, polls: calls.filter((c) => c.tool === "bash" && /(tail|cat|pgrep|ls)\b.*(\.out|\.log)|sleep/.test(c.args)).length, bashCalls: calls.filter((c) => c.tool === "bash").length, lancia: calls.filter((c) => c.tool === "lancia").length, requests, cost: Math.round(cost), seconds, settles, jobDone, calls, answer: answer.slice(0, 200) };
writeFileSync(new URL(`result-${duration}-${arm}-${rep}.json`, import.meta.url), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, calls: undefined, answer: undefined }));
