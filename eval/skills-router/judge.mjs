// Blind quality judge: for the tasks where a skill fired, compare base vs skill diffs (order randomised) on quality
// dimensions that tests don't see. Run after ab.mjs: node eval/skills-router/judge.mjs   Output: judge.jsonl
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cases } from "../cases.mjs";
const work = "/tmp/skills-ab";
const rows = readFileSync(join(import.meta.dirname, "ab.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const fired = [...new Set(rows.filter((r) => r.arm === "skill" && r.skills.length).map((r) => `${r.id}|${r.rep}`))];
const diff = (d) => { try { return execFileSync("sh", ["-c", "git add -A -N . && git diff HEAD"], { cwd: d, encoding: "utf8" }).slice(0, 12000); } catch { return ""; } };
const out = [];
for (const key of fired) {
	const [id, rep] = key.split("|");
	const task = cases.find((c) => c.id === id).turns[0];
	const flip = Math.random() < 0.5;
	const base = diff(join(work, `${id}-base-${rep}`)), skill = diff(join(work, `${id}-skill-${rep}`));
	const [A, B] = flip ? [skill, base] : [base, skill];
	const prompt = `Two engineers solved the same task. Judge ONLY the final code changes (diffs), blind.\nTask: ${task}\n\n=== DIFF A ===\n${A}\n\n=== DIFF B ===\n${B}\n\nFor each dimension answer "A", "B" or "tie": reasoning (root cause addressed, not a symptom patch), verification (tests added/edge cases covered), cleanliness (minimal, focused, idiomatic diff), professionalism (naming, comments, no leftovers). Reply ONLY JSON: {"reasoning":"","verification":"","cleanliness":"","professionalism":"","overall":""}`;
	const r = spawnSync("claude", ["-p", "--model", "opus", "--tools", ""], { input: prompt, encoding: "utf8" });
	try {
		const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1));
		const un = (v) => (v === "tie" ? "tie" : (v === "A") === flip ? "skill" : "base");
		out.push({ id, rep, ...Object.fromEntries(Object.entries(j).map(([k, v]) => [k, un(v)])) });
	} catch { out.push({ id, rep, error: r.stdout.slice(-100) }); }
}
writeFileSync(join(import.meta.dirname, "judge.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
for (const dim of ["reasoning", "verification", "cleanliness", "professionalism", "overall"]) {
	const c = { skill: 0, base: 0, tie: 0 }; for (const o of out) if (o[dim]) c[o[dim]]++;
	console.log(dim, JSON.stringify(c));
}
