#!/usr/bin/env node
// Deep quality analysis of bench runs (reads results.jsonl, inspects each kept run directory):
//  1. graded hidden-test score (share of individual checks passed, not only pass/fail)
//  2. the model's own tests: how many, do they pass
//  3. code size
//  4. blind Opus judge: sees only the task and the files (never the arm), scores 1-5 and lists concrete defects
// Usage: node eval/advisor/analyze.mjs [--in results.jsonl] [--judge 1]   (--judge 0 skips the Opus judge)
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argument = (n, f) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : f);
const input = argument("in", join(here, "results.jsonl"));
const judging = argument("judge", "1") !== "0";
const SEMVER = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "npm", "node_modules", "semver", "index.js");
const HIDDEN = { H1: "H1.mjs", H2: "H2.mjs", H3: "H3.mjs", H4: "H4.mjs", H5: "H5.mjs", H6: "H6.mjs" };
const SOURCE = { H1: ["calc.js", "calc.test.js"], H2: ["src/orders.js", "test.js"], H3: ["semver.js", "semver.test.js"], H4: ["diff.js", "diff.test.js"], H5: ["regex.js", "regex.test.js"], H6: ["cron.js", "cron.test.js"] };
const TASK = { H6: "cron.js exporting nextRun(expr, fromMs, timeZone): next instant matching a 5-field cron expression in an IANA time zone, correct around DST (skipped local times, repeated local times), day-of-month/day-of-week OR rule, SyntaxError/RangeError on invalid input.", H5: "regex.js exporting match(pattern, text): hand-written backtracking regex engine identical to JavaScript RegExp.exec (captures, lazy quantifiers, backreferences, empty-iteration rule, SyntaxError on invalid patterns).", H1: "Arithmetic expression evaluator with precedence, right-associative ^, unary minus rules, min/max/sqrt/abs, SyntaxError with numeric position, ReferenceError, RangeError.", H2: "Fix order pricing in src/orders.js so it follows README.md (integer cents, half-up rounding, coupon after line discounts, shipping/tax rules, no input mutation).", H3: "semver.js exporting compare and satisfies behaving exactly like npm semver 7 (ranges: caret, tilde, x-ranges, hyphen, ||, prerelease rule), no dependencies.", H4: "diff.js exporting unifiedDiff matching `diff -u`: minimal edit script, hunks with context, merged hunks, valid for `patch`." };

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const records = readFileSync(input, "utf8").trim().split("\n").map((l) => JSON.parse(l));

function graded(r) {
	writeFileSync(join(r.dir, "hidden.mjs"), readFileSync(join(here, "hidden", HIDDEN[r.task]), "utf8"));
	const out = spawnSync("node", ["hidden.mjs"], { cwd: r.dir, encoding: "utf8", env: { ...process.env, HIDDEN_GRADED: "1", SEMVER_ORACLE: SEMVER }, timeout: 120_000 });
	const line = `${out.stdout}${out.stderr}`.split("\n").find((l) => l.startsWith("SCORE "));
	if (!line) return { share: 0, failed: "no score (crashed or missing file)", samples: [] };
	const s = JSON.parse(line.slice(6));
	return { share: s.total ? (s.total - s.failed) / s.total : 0, failed: s.failed, total: s.total, samples: s.samples };
}

function ownTests(r) {
	const file = SOURCE[r.task][1];
	const text = read(join(r.dir, file));
	const count = (text.match(/^\s*(test|it)\(/gm) ?? []).length || (text.match(/assert\./g) ?? []).length;
	let passes = false;
	if (text) {
		const run = spawnSync("node", [file.startsWith("test.js") ? file : "--test", ...(file === "test.js" ? [] : [file])].filter(Boolean), { cwd: r.dir, encoding: "utf8", timeout: 120_000 });
		passes = run.status === 0;
	}
	return { count, passes, exists: Boolean(text) };
}

function judge(r) {
	const files = SOURCE[r.task].map((f) => `=== ${f} ===\n${read(join(r.dir, f)).slice(0, 14000)}`).join("\n\n");
	const prompt = `You are a strict, independent code reviewer. Task given to the developer: ${TASK[r.task]}\n\nReview ONLY the files below. Find real bugs by reading and mentally running edge cases; do not praise. Reply with JSON only, no fences:\n{"correctness":1-5,"edge_cases":1-5,"robustness":1-5,"test_quality":1-5,"readability":1-5,"defects":["concrete defect with the input that breaks it", ...]}\nScale: 5 = nothing to fault, 3 = works on the main path but misses real edge cases, 1 = broken.\n\n${files}`;
	const out = spawnSync("pi", ["-p", "--no-session", "--provider", "claude-code", "--model", "opus", prompt], { encoding: "utf8", env: { ...process.env, PI_ADVISOR: "0", PI_CLAUDE_ADVISOR: "off" }, timeout: 600_000, cwd: "/tmp" });
	const match = /\{[\s\S]*\}/.exec(out.stdout ?? "");
	try {
		return JSON.parse(match?.[0] ?? "");
	} catch {
		return null;
	}
}

const rows = [];
for (const r of records) {
	if (!existsSync(r.dir)) continue;
	const g = graded(r);
	const t = ownTests(r);
	const loc = read(join(r.dir, SOURCE[r.task][0])).split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length;
	const j = judging ? judge(r) : null;
	const row = { task: r.task, arm: r.arm, rep: r.rep, pass: r.pass, share: g.share, failed: g.failed, samples: g.samples, ownTests: t.count, ownPass: t.passes, loc, judge: j, seconds: r.seconds, cost: r.cost };
	rows.push(row);
	console.log(`${r.task} ${r.arm.padEnd(7)} #${r.rep} graded=${(g.share * 100).toFixed(1)}% own=${t.count}${t.passes ? "✓" : "✗"} loc=${loc}${j ? ` judge=${["correctness", "edge_cases", "robustness", "test_quality", "readability"].map((k) => j[k]).join("/")} defects=${j.defects?.length ?? "?"}` : ""}`);
}
writeFileSync(join(here, "analysis.json"), JSON.stringify(rows, null, 1));

console.log("\n== Difetti e limiti misurati (prima) ==");
for (const row of rows.filter((x) => x.share < 1 || (x.judge?.defects?.length ?? 0) > 0)) {
	console.log(`- ${row.task} ${row.arm} #${row.rep}: hidden ${row.failed} check falliti${row.samples?.[0] ? ` (es. ${row.samples[0]})` : ""}${row.judge?.defects?.length ? `; giudice: ${row.judge.defects.slice(0, 3).join(" | ")}` : ""}`);
}
console.log("\n== Medie per braccio ==\nbraccio  graded%  ownPass  loc   giudice(corr/edge/rob/test/leggib)  difetti");
for (const arm of [...new Set(rows.map((x) => x.arm))]) {
	const m = rows.filter((x) => x.arm === arm);
	const avg = (f) => m.reduce((s, x) => s + f(x), 0) / m.length;
	const jm = m.filter((x) => x.judge);
	const ja = (k) => (jm.length ? (jm.reduce((s, x) => s + (x.judge[k] ?? 0), 0) / jm.length).toFixed(1) : "-");
	console.log(`${arm.padEnd(8)} ${(avg((x) => x.share) * 100).toFixed(1).padEnd(8)} ${m.filter((x) => x.ownPass).length}/${m.length}`.padEnd(30) + ` ${Math.round(avg((x) => x.loc)).toString().padEnd(5)} ${["correctness", "edge_cases", "robustness", "test_quality", "readability"].map(ja).join("/").padEnd(34)} ${jm.length ? (jm.reduce((s, x) => s + (x.judge.defects?.length ?? 0), 0) / jm.length).toFixed(1) : "-"}`);
}
