// Blind judge for complex.mjs: base vs skill, diff + final answer, order randomised. Output: complex-judge.jsonl
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tasks } from "./complex.mjs";
const rows = readFileSync(join(import.meta.dirname, "complex.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const diff = (d) => { try { return execFileSync("sh", ["-c", "git add -A -N . && git diff 438a854 -- . ':!package-lock.json'"], { cwd: d, encoding: "utf8" }).slice(0, 14000); } catch { return ""; } };
const out = [];
for (const key of [...new Set(rows.map((r) => `${r.id}|${r.rep}`))]) {
	const [id, rep] = key.split("|");
	const get = (arm) => ({ d: diff(`/tmp/skills-cx/${id}-${arm}-${rep}`), a: rows.find((r) => r.id === id && r.arm === arm && String(r.rep) === rep)?.answer ?? "" });
	const flip = Math.random() < 0.5, b = get("base"), s = get("skill"), [A, B] = flip ? [s, b] : [b, s];
	const prompt = `Two engineers solved the same task. Judge blind, on the final diff and the final message.\nTask: ${tasks.find((t) => t.id === id).prompt}\n\n=== A diff ===\n${A.d}\n=== A final message ===\n${A.a}\n\n=== B diff ===\n${B.d}\n=== B final message ===\n${B.a}\n\nFor each dimension answer "A", "B" or "tie": reasoning (root cause, hidden cases considered), verification (tests added, what was actually checked and reported honestly), cleanliness (focused, minimal, idiomatic), professionalism (naming, docs, no leftovers, clear report), overall. Reply ONLY JSON: {"reasoning":"","verification":"","cleanliness":"","professionalism":"","overall":""}`;
	const r = spawnSync("claude", ["-p", "--model", "opus", "--tools", ""], { input: prompt, encoding: "utf8" });
	try {
		const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1));
		out.push({ id, rep, ...Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v === "tie" ? "tie" : (v === "A") === flip ? "skill" : "base"])) });
	} catch { out.push({ id, rep, error: r.stdout.slice(-100) }); }
}
writeFileSync(join(import.meta.dirname, "complex-judge.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
for (const dim of ["reasoning", "verification", "cleanliness", "professionalism", "overall"]) { const c = { skill: 0, base: 0, tie: 0 }; for (const o of out) if (o[dim]) c[o[dim]]++; console.log(dim, JSON.stringify(c)); }
for (const o of out) console.log(o.id, o.rep, o.overall);
