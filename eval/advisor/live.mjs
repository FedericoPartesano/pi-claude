#!/usr/bin/env node
// Empirical check of extensions/advisor.ts: the same tasks with Haiku alone and with Haiku + automatic Opus advisor.
// Each task has hidden tests (written after the run) so the score is pass/fail on real behavior, not on what the model says.
// Usage: node eval/advisor/live.mjs [--reps 1] [--only T1,T2] [--arms solo,advisor] [--model haiku]
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const model = argument("model", "haiku");
const reps = Number(argument("reps", "1"));
const only = argument("only", "").split(",").filter(Boolean);
const arms = argument("arms", "solo,advisor").split(",");

const TASKS = [
	{ id: "T1", what: "parseDuration con casi limite",
		prompt: "Create dur.js (ES module, `export function parseDuration(text)`) that converts a duration string to milliseconds. Units: d, h, m, s, ms, combinable like '1h30m' or '1h 30m' (spaces allowed), decimals allowed ('1.5h'), case-insensitive. Reject with a TypeError: empty or non-string input, negative numbers, unknown units, a number without unit, and text that is not fully consumed ('1h garbage'). Be careful that 'm' (minutes) and 'ms' (milliseconds) are different units. Write nothing else.",
		setup: () => {},
		test: `import { parseDuration as p } from "./dur.js";
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ": " + a + " != " + b); };
const bad = (v, m) => { try { p(v); } catch (e) { if (e instanceof TypeError) return; throw new Error(m + ": wrong error"); } throw new Error(m + ": no throw"); };
eq(p("1h30m"), 5400000, "1h30m"); eq(p("1h 30m"), 5400000, "spaces"); eq(p("1.5h"), 5400000, "decimal");
eq(p("250ms"), 250, "ms"); eq(p("2d"), 172800000, "d"); eq(p("1M"), 60000, "case"); eq(p("1m500ms"), 60500, "m+ms");
bad("", "empty"); bad(5, "number"); bad("-1h", "neg"); bad("5", "no unit"); bad("1x", "unit"); bad("1h garbage", "garbage");`,
	},
	{ id: "T2", what: "cache LRU con TTL e clock iniettato",
		prompt: "Create cache.js (ES module) exporting `class TtlCache` with constructor(maxSize, ttlMs, now = Date.now): get(key), set(key, value), delete(key), and a `size` getter. Rules: entries older than ttlMs are expired and behave as missing; `size` never counts expired entries; set on an existing key replaces the value AND restarts its TTL; when the cache is full, the least recently used live entry is evicted (both get and set count as use); get of a missing or expired key returns undefined. The clock `now` must be the injected function, never Date.now directly. Write nothing else.",
		setup: () => {},
		test: `import { TtlCache } from "./cache.js";
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ": " + a + " != " + b); };
let t = 0; const c = new TtlCache(2, 100, () => t);
c.set("a", 1); t = 50; c.set("b", 2); eq(c.get("a"), 1, "get a"); // a is now most recent
c.set("c", 3); eq(c.get("b"), undefined, "b evicted (LRU)"); eq(c.get("a"), 1, "a kept"); eq(c.size, 2, "size 2");
t = 120; eq(c.get("a"), undefined, "a expired"); eq(c.size, 1, "size counts only live (c)");
c.set("c", 33); t = 200; eq(c.get("c"), 33, "set restarts TTL");
t = 400; eq(c.size, 0, "all expired"); eq(c.delete("zzz"), false, "delete missing");`,
	},
	{ id: "T3", what: "rinomina in piu file con alias deprecato",
		prompt: "In this project rename the function getUser to fetchUser everywhere: src/users.js, src/app.js, test.js and README.md. Keep `getUser` exported from src/users.js as a deprecated alias of fetchUser that calls console.warn('getUser is deprecated, use fetchUser') only the first time it is called. Behavior must not change and `node test.js` must still pass. Do not leave getUser anywhere else (code, tests, docs) except the alias definition.",
		setup: (dir) => {
			mkdirSync(join(dir, "src"));
			writeFileSync(join(dir, "src/users.js"), `const users = { 1: { id: 1, name: "Ada" }, 2: { id: 2, name: "Linus" } };\nexport function getUser(id) {\n\treturn users[id] ?? null;\n}\nexport function listUsers() {\n\treturn Object.values(users).map((u) => getUser(u.id));\n}\n`);
			writeFileSync(join(dir, "src/app.js"), `import { getUser } from "./users.js";\nexport const greet = (id) => { const user = getUser(id); return user ? "hi " + user.name : "who?"; };\n`);
			writeFileSync(join(dir, "test.js"), `import assert from "node:assert";\nimport { getUser } from "./src/users.js";\nimport { greet } from "./src/app.js";\nassert.equal(getUser(1).name, "Ada");\nassert.equal(greet(2), "hi Linus");\nassert.equal(greet(9), "who?");\nconsole.log("ok");\n`);
			writeFileSync(join(dir, "README.md"), "# users\n\nUse `getUser(id)` to read a user.\n");
			writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
		},
		test: `import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const fail = (m) => { throw new Error(m); };
const users = readFileSync("src/users.js", "utf8");
if (!/export function fetchUser|export const fetchUser/.test(users)) fail("fetchUser not exported");
if (!/getUser/.test(users) || !/deprecated, use fetchUser/.test(users)) fail("alias missing");
for (const f of ["src/app.js", "test.js", "README.md"]) if (/getUser/.test(readFileSync(f, "utf8"))) fail("getUser left in " + f);
const { getUser, fetchUser } = await import("./src/users.js");
const warn = console.warn; let n = 0; console.warn = () => n++;
getUser(1); getUser(2); console.warn = warn;
if (n !== 1) fail("warn count " + n);
if (fetchUser(1).name !== "Ada") fail("behavior");
execSync("node test.js", { stdio: "pipe" });`,
	},
	{ id: "T4", what: "fusione intervalli con trappole (input non ordinato, non mutato, bordi)",
		prompt: "Create intervals.js (ES module) exporting `mergeIntervals(list)` for [start, end] pairs of numbers. Return a new sorted array where overlapping OR touching intervals ([1,3] and [3,5]) are merged. The input may be unsorted and must NOT be mutated (neither the array nor the inner pairs). Empty input returns []. Throw a RangeError if any pair has start > end, and a TypeError if a pair is not two finite numbers. Also create intervals.test.js using node:test that covers each rule, and run it with `node --test` until it passes.",
		setup: () => {},
		test: `import { mergeIntervals as m } from "./intervals.js";
const j = JSON.stringify; const eq = (a, b, x) => { if (j(a) !== j(b)) throw new Error(x + ": " + j(a) + " != " + j(b)); };
const input = [[5, 8], [1, 3], [3, 4], [10, 12]]; const copy = j(input);
eq(m(input), [[1, 4], [5, 8], [10, 12]], "merge"); eq(j(input), copy, "mutated");
eq(m([]), [], "empty"); eq(m([[1, 2]]), [[1, 2]], "single"); eq(m([[1, 10], [2, 3]]), [[1, 10]], "nested");
const out = m(input); out[0][0] = 99; eq(j(input), copy, "inner pairs shared");
const thr = (v, C) => { try { m(v); } catch (e) { if (e instanceof C) return; throw new Error("wrong error " + e); } throw new Error("no throw"); };
thr([[5, 1]], RangeError); thr([[1]], TypeError); thr([[1, NaN]], TypeError); thr([["a", 2]], TypeError);
import { existsSync } from "node:fs"; if (!existsSync("intervals.test.js")) throw new Error("no test file");`,
	},
];

function run(task, arm, rep) {
	const dir = mkdtempSync(join(tmpdir(), `adv-${task.id}-${arm}-`));
	execSync("git init -q", { cwd: dir });
	task.setup(dir);
	const log = join(dir, ".advisor.log");
	const env = { ...process.env, PI_ADVISOR_LOG: log, ...(arm === "solo" ? { PI_ADVISOR: "0" } : {}) };
	const started = Date.now();
	return new Promise((done) => {
		const child = spawn("pi", ["-p", "--no-session", "--provider", "claude-code", "--model", model, task.prompt], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (c) => (out += c));
		child.stderr.on("data", (c) => (out += c));
		const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
		child.on("close", () => {
			clearTimeout(timer);
			let pass = false;
			let why = "";
			try {
				writeFileSync(join(dir, "hidden.mjs"), task.test);
				execSync("node hidden.mjs", { cwd: dir, stdio: "pipe" });
				pass = true;
			} catch (error) {
				why = String(error.stderr ?? error.message).split("\n").find((l) => /Error/.test(l)) ?? "failed";
			}
			const consults = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
			done({ id: task.id, arm, rep, pass, why, seconds: Math.round((Date.now() - started) / 1000), consults, dir });
		});
	});
}

const jobs = [];
for (const task of TASKS.filter((t) => !only.length || only.includes(t.id))) for (const arm of arms) for (let rep = 1; rep <= reps; rep++) jobs.push([task, arm, rep]);
const results = await Promise.all(jobs.map(([task, arm, rep]) => run(task, arm, rep)));
for (const r of results.sort((a, b) => a.id.localeCompare(b.id) || a.arm.localeCompare(b.arm))) {
	const kinds = r.consults.map((c) => `${c.kind}${c.ok ? "" : "!"}`).join(",") || "-";
	console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.arm.padEnd(7)} #${r.rep} ${String(r.seconds).padStart(4)}s consults=${kinds}${r.pass ? "" : `  (${r.why})`}  ${r.dir}`);
}
for (const arm of arms) {
	const mine = results.filter((r) => r.arm === arm);
	const avg = mine.reduce((s, r) => s + r.seconds, 0) / (mine.length || 1);
	console.log(`${arm}: ${mine.filter((r) => r.pass).length}/${mine.length} pass, ${Math.round(avg)}s medi, ${mine.reduce((s, r) => s + r.consults.length, 0)} consulti Opus`);
}
