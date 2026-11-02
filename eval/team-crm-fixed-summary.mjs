#!/usr/bin/env node
// Mean per arm of a team-crm-fixed run. Usage: node team-crm-fixed-summary.mjs results/<run>.jsonl [...]
import { readFileSync } from "node:fs";
const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map(JSON.parse));
const mean = (g, k) => Math.round(g.reduce((s, r) => s + r[k], 0) / g.length);
const out = {};
for (const arm of ["crm", "free"]) {
	const g = rows.filter((r) => r.arm === arm);
	if (!g.length) continue;
	out[arm] = { n: g.length, pass: g.filter((r) => r.pass).length, seconds: mean(g, "seconds"), input: mean(g, "input"), output: mean(g, "output"), requests: mean(g, "requests") };
}
console.log(out);
if (out.crm && out.free) for (const k of ["seconds", "input", "output", "requests"]) console.log(k, `${Math.round((out.crm[k] / out.free[k] - 1) * 100)}%`);
