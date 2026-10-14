#!/usr/bin/env node
// Does Haiku + Opus advisor match Opus alone with less cost and time? Hard, long tasks with hidden tests (eval/advisor/hidden/).
// Arms: opus (Opus alone), advisor (Haiku + native Claude Code advisor (--advisor opus)), solo (Haiku alone), brief (Opus writes the intent, Haiku runs /goal).
// Runs in sequence by default so times are comparable. Usage:
//   node eval/advisor/bench.mjs [--reps 3] [--only H1,H2] [--arms opus,advisor,solo] [--parallel 1] [--out results.jsonl]
// Cost is a RELATIVE estimate: Anthropic price ratios assumed (Haiku 1x, Opus 5x of the Haiku rate; cache read 0.1x, cache write 1.25x
// of input, output 5x of input). Change PRICE below if the real prices differ. Tokens are also reported raw.
import { execSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const reps = Number(argument("reps", "3"));
const only = argument("only", "").split(",").filter(Boolean);
const arms = argument("arms", "opus,advisor,solo").split(",");
const parallel = Number(argument("parallel", "1"));
const outFile = argument("out", join(here, "results.jsonl"));
// H3 compares against the npm semver package that ships with npm (the models must not use it).
const SEMVER = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "npm", "node_modules", "semver", "index.js");

const PRICE = { haiku: 1, sonnet: 3, opus: 5 }; // relative to the Haiku input rate
const cost = (model, u) => (PRICE[model] ?? 1) * (u.input + 1.25 * u.cacheWrite + 0.1 * u.cacheRead + 5 * u.output);
const family = (id = "") => (/opus/i.test(id) ? "opus" : /sonnet/i.test(id) ? "sonnet" : "haiku");

const BUGGY_ORDERS = `export const TAX_RATE = 0.22;

export function lineTotal(line) {
	const gross = line.qty * line.unitPrice;
	return line.qty > 10 ? Math.floor(gross * 0.9) : gross;
}

export function applyCoupon(subtotal, code) {
	if (code === "SAVE5") return subtotal - 500;
	if (code === "HALF") return Math.floor(subtotal / 2);
	return subtotal;
}

export function priceOrder(order) {
	const gross = order.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
	const afterCoupon = applyCoupon(order.lines.reduce((sum, line) => sum + lineTotal(line), 0), order.coupon);
	const shipping = gross >= 5000 ? 0 : 599;
	const tax = Math.round((afterCoupon + shipping) * TAX_RATE);
	return { subtotal: afterCoupon, shipping, tax, total: afterCoupon + shipping + tax };
}
`;

const TASKS = [
	{ id: "H1", what: "valutatore di espressioni (parser con precedenze ed errori con posizione)",
		prompt: `Create calc.js (ES module) exporting \`evaluate(expression, variables = {})\` that evaluates an arithmetic expression string and returns a number. Write a recursive-descent parser by hand; never use eval or new Function.
Grammar and rules:
- Numbers: decimals like 12, 1.5, .5 (a bare "1." or "1..2" is invalid). Identifiers (letters, digits, underscore, not starting with a digit) are looked up in \`variables\`.
- Binary operators, from loosest to tightest: + and - (left associative), * / % (left associative), ^ (RIGHT associative: 2^3^2 = 512). % is the JavaScript remainder (-7%3 = -1).
- Unary minus binds looser than ^ but tighter than * : -2^2 = -4, 2*-3 = -6, --3 = 3, and the exponent may be unary: 2^-1 = 0.5. Unary plus is NOT supported.
- Parentheses; whitespace (spaces, tabs) is allowed between tokens.
- Functions: min(...), max(...) with one or more arguments, sqrt(x), abs(x). Arguments are comma separated; the argument count must be right (min() and min(1,) are errors).
Errors (each must be thrown as the exact class):
- SyntaxError for anything malformed: empty or whitespace-only input, unbalanced parentheses, a missing operand, two operands in a row ("2 3"), unknown characters, unknown function names, wrong argument count, trailing garbage. Every SyntaxError must have a numeric \`position\` property: the zero-based index in the source string of the offending token, or the length of the string when the input ends unexpectedly (for "(1+2" the position is 4; for "1+@" it is 2; for "2 3" it is 2).
- ReferenceError for an identifier that is not in \`variables\`.
- RangeError for division or remainder by zero and for sqrt of a negative number.
Also create calc.test.js using node:test with several cases for every rule above, and run \`node --test\` until it passes.`,
		setup: () => {}, hidden: "H1.mjs" },
	{ id: "H2", what: "bug di pricing in piu punti: il codice non rispetta il README",
		prompt: "The order pricing in src/orders.js does not follow the rules in README.md: some results are wrong, in more than one place, and money must be exact. Find every violation and fix it. Keep the exports and their signatures (lineTotal, applyCoupon, priceOrder, TAX_RATE may change only if the rules require it), do not edit README.md, do not mutate the order passed in, and make sure `node test.js` passes. Also add to test.js a case for each rule that was wrong.",
		setup: (dir) => {
			mkdirSync(join(dir, "src"));
			writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
			writeFileSync(join(dir, "src/orders.js"), BUGGY_ORDERS);
			writeFileSync(join(dir, "README.md"), `# Order pricing

All amounts are integers, in cents. Every rounding is "half up to the cent", computed exactly (no floating point error).

An order is { lines: [{ qty, unitPrice }], coupon?: string }. priceOrder(order) returns { subtotal, shipping, tax, total }.

1. A line costs qty * unitPrice. If qty is 10 or more, the line total becomes 90% of qty * unitPrice, with that result rounded half up.
2. The coupon applies AFTER the line discounts, on the sum of the lines. "SAVE5" takes 500 off, never going below 0. "HALF" leaves 50% of the sum, with that result rounded half up. Any other coupon is ignored.
3. subtotal is the sum after line discounts and coupon.
4. shipping is 0 for an empty order; otherwise 0 when subtotal is 5000 or more, else 599.
5. tax is 22% of subtotal ONLY (not of shipping), rounded half up.
6. total = subtotal + shipping + tax.
`);
			writeFileSync(join(dir, "test.js"), `import assert from "node:assert";\nimport { priceOrder } from "./src/orders.js";\nassert.deepEqual(priceOrder({ lines: [{ qty: 1, unitPrice: 1000 }] }), { subtotal: 1000, shipping: 599, tax: 220, total: 1819 });\nconsole.log("ok");\n`);
		}, hidden: "H2.mjs" },
	{ id: "H3", what: "semver: compare e satisfies identici al pacchetto npm",
		prompt: `Create semver.js (ES module, no dependencies; do NOT import or require the npm "semver" package or any other package) exporting \`compare(a, b)\` and \`satisfies(version, range)\` that behave exactly like the npm \`semver\` package, version 7, with default options.
- Versions: MAJOR.MINOR.PATCH with optional -prerelease and +build (build metadata is ignored). No leading zeros in numbers, no "v" prefix. compare returns a negative number, 0 or a positive number by semver precedence (prerelease identifiers: numeric ones compare as numbers and rank below alphanumeric ones; a shorter list ranks lower when all earlier ones are equal; a version with a prerelease ranks below the same version without). compare throws TypeError for an invalid version.
- Ranges: comparators = < <= > >= (and a bare version, meaning =); caret (^1.2.3, ^0.2.3, ^0.0.3, ^1.2, ^1.x, ^0), tilde (~1.2.3, ~1.2, ~1), x-ranges (1.x, 1.2.*, 1, 1.2, x, *, and the empty string, all meaning "any" where applicable), hyphen ranges ("1.2.3 - 2.3.4", "1.2 - 2"), AND by whitespace, OR with ||. Partial versions in comparators follow npm rules (for example >1.2 means >=1.3.0 and <=1.2 means <1.3.0).
- Prerelease rule: a prerelease version only satisfies a range if one of the comparators in the same comparator set has a prerelease on the same MAJOR.MINOR.PATCH.
- satisfies returns false (it never throws) when the version or the range is invalid.
Also create semver.test.js using node:test with many cases, and run \`node --test\` until it passes.`,
		setup: () => {}, hidden: "H3.mjs" },
	{ id: "H4", what: "diff unificato minimo applicabile con patch",
		prompt: `Create diff.js (ES module, no dependencies) exporting \`unifiedDiff(a, b, { context = 3, nameA = "a", nameB = "b" } = {})\` where a and b are strings made of lines that each end with "\\n" (or the empty string). It returns the unified diff text in the same format as \`diff -u\`: first "--- <nameA>" and "+++ <nameB>" (no timestamps), then hunks. Rules: return "" when a and b are identical; the edit script must be minimal (the same number of added plus removed lines as GNU diff -u); each hunk has \`context\` unchanged lines around the changes, and changes whose context overlaps or touches are merged into one hunk; hunk headers are "@@ -start,count +start,count @@" where a count of 1 is written without ",count", and a hunk with 0 lines on one side uses the line BEFORE the insertion/deletion as start (so "@@ -0,0 +1,2 @@" for adding two lines to an empty file). The output must end with a newline and must be accepted by the \`patch\` command, producing b from a. Input without a final newline is out of scope. Also create diff.test.js using node:test, including a test that runs the real \`diff -u\` and \`patch\` on temporary files, and run \`node --test\` until it passes.`,
		setup: () => {}, hidden: "H4.mjs" },
	{ id: "H5", what: "motore regex a backtracking identico a RegExp di JS",
		prompt: `Create regex.js (ES module, no dependencies) exporting \`match(pattern, text)\`: a backtracking regular expression engine written by hand (do NOT use RegExp, new RegExp, String.prototype.match/replace/search/split with regexes, or any regex library to do the matching). It must return exactly what \`new RegExp(pattern).exec(text)\` returns in JavaScript, as an array-like with \`index\` (match start, scanning left to right, first match wins) and the captured strings (element 0 is the whole match, then capture groups numbered by opening parenthesis; a group that did not participate is undefined), or null when there is no match. Support: literals, ".", escapes \\d \\w \\s \\D \\W \\S and escaped metacharacters, character classes with ranges and negation ([a-c], [^ab], a literal "-" at the edges), anchors ^ and $ (no flags: "." does not match \\n), alternation |, capturing groups (...), non-capturing groups (?:...), backreferences \\1..\\9 (a reference to a group that did not participate matches the empty string), quantifiers * + ? {n} {n,} {n,m} each with a lazy variant, exactly with JavaScript semantics: greedy by default, captures inside a repeated group are reset at the start of every iteration, and an iteration of * or + that matches the empty string must stop the loop (as in the ECMAScript spec). Throw SyntaxError for an invalid pattern (unbalanced parentheses, nothing to repeat, unterminated class, {n,m} with n>m, trailing backslash). Also create regex.test.js using node:test with many cases (compare with the real RegExp inside the tests), and run \`node --test\` until it passes.`,
		setup: () => {}, hidden: "H5.mjs" },
	{ id: "H6", what: "cron nextRun con fusi orari e ora legale",
		prompt: `Create cron.js (ES module, no dependencies) exporting \`nextRun(expr, fromMs, timeZone)\`: it returns the earliest instant, as UTC milliseconds, strictly after fromMs at which the wall-clock time in the IANA timeZone matches the 5-field cron expression "minute hour day-of-month month day-of-week", or null when there is no match in the next 4 years. Fields: "*", numbers, lists (1,15), ranges (1-5), steps (*/15, 10-30/5, 5/20 meaning 5-max step 20); minute 0-59, hour 0-23, day-of-month 1-31, month 1-12, day-of-week 0-7 (0 and 7 are Sunday). Standard cron rule: if both day-of-month and day-of-week are restricted (their text does not start with "*"), a day matches when EITHER matches; otherwise both must match. Daylight saving time: a local time that does not exist (spring forward) is simply skipped, with no run that day; a local time that happens twice (fall back) runs at both instants, so every UTC instant whose local fields match counts. Use only built-in Intl for time zones (some zones have a 30-minute DST shift, e.g. Australia/Lord_Howe). Throw SyntaxError for an invalid expression (wrong number of fields, value out of range, step 0, range with start > end, non-numeric text) and RangeError for an unknown time zone. Also create cron.test.js with node:test and many cases (including DST days in America/New_York, Europe/Rome and Australia/Lord_Howe), and run \`node --test\` until it passes.`,
		setup: () => {}, hidden: "H6.mjs" },
];

function add(by, model, u) {
	const t = (by[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	t.input += u.input ?? 0;
	t.output += u.output ?? 0;
	t.cacheRead += u.cacheRead ?? 0;
	t.cacheWrite += u.cacheWrite ?? 0;
}

function usageOf(lines) {
	const by = {};
	for (const line of lines) {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type !== "message_end" || event.message?.role !== "assistant" || !event.message.usage) continue;
		add(by, family(event.message.model ?? event.message.responseModel), event.message.usage);
	}
	return by;
}

function pi(dir, args, env) {
	return new Promise((resolve) => {
		const child = spawn("pi", ["-p", "--mode", "json", "--no-session", "--provider", "claude-code", ...args], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (c) => (out += c));
		child.stderr.on("data", () => {});
		const timer = setTimeout(() => child.kill("SIGTERM"), 25 * 60_000);
		child.on("close", () => {
			clearTimeout(timer);
			resolve(out.split("\n"));
		});
	});
}

async function run(task, arm, rep) {
	const dir = mkdtempSync(join(tmpdir(), `bench-${task.id}-${arm}-`));
	execSync("git init -q", { cwd: dir });
	task.setup(dir);
	const log = join(dir, ".advisor.log");
	const env = { ...process.env, PI_ADVISOR_LOG: log, PI_ADVISOR: arm === "brief" ? "1" : "0", PI_CLAUDE_ADVISOR: arm === "advisor" ? "opus" : "off" };
	const started = Date.now();
	const usage = {};
	const merge = (by) => {
		for (const [m, u] of Object.entries(by)) add(usage, m, u);
	};
	if (arm === "brief") {
		merge(usageOf(await pi(dir, ["--model", "haiku", `/brief ${task.prompt}`], env)));
		const intents = existsSync(join(dir, "intents")) ? readdirSync(join(dir, "intents")) : [];
		if (intents[0]) merge(usageOf(await pi(dir, ["--model", "haiku", `/goal --max 5 @intents/${intents[0]}`], env)));
	} else {
		merge(usageOf(await pi(dir, ["--model", arm === "opus" ? "opus" : "haiku", task.prompt], env)));
	}
	const seconds = Math.round((Date.now() - started) / 1000);
	const consults = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
	for (const c of consults) if (c.usage) add(usage, "opus", c.usage);
	// Native advisor: Opus tokens come from the Claude Code result (modelUsage), per run of the claude process.
	if (arm === "advisor") {
		for (const c of consults.filter((x) => x.kind === "native")) {
			const m = Object.entries(c.modelUsage).find(([id]) => /opus/i.test(id))?.[1];
			if (m) add(usage, "opus", { input: m.inputTokens, output: m.outputTokens, cacheRead: m.cacheReadInputTokens, cacheWrite: m.cacheCreationInputTokens });
		}
	}
	let pass = false;
	let why = "";
	try {
		writeFileSync(join(dir, "hidden.mjs"), readFileSync(join(here, "hidden", task.hidden), "utf8"));
		execSync("node hidden.mjs", { cwd: dir, stdio: "pipe", env: { ...process.env, SEMVER_ORACLE: SEMVER } });
		pass = true;
	} catch (error) {
		why = String(error.stderr ?? error.message).split("\n").find((l) => /Error/.test(l))?.slice(0, 240) ?? "failed";
	}
	const costUsd = consults.filter((c) => c.kind === "native").reduce((sum, c) => sum + (c.totalCostUsd ?? 0), 0);
	const record = { task: task.id, arm, rep, pass, why, seconds, costUsd: Number(costUsd.toFixed(4)), consults: consults.map((c) => c.kind).filter((k) => k !== "native"), usage, cost: Math.round(Object.entries(usage).reduce((s, [m, u]) => s + cost(m, u), 0)), dir };
	appendFileSync(outFile, `${JSON.stringify(record)}\n`);
	console.log(`${pass ? "PASS" : "FAIL"} ${task.id} ${arm.padEnd(7)} #${rep} ${String(seconds).padStart(4)}s cost=${record.cost} usd=${record.costUsd} consults=${record.consults.join(",") || "-"}${pass ? "" : `  (${why})`}`);
	return record;
}

const jobs = [];
for (let rep = 1; rep <= reps; rep++) for (const task of TASKS.filter((t) => !only.length || only.includes(t.id))) for (const arm of arms) jobs.push(() => run(task, arm, rep));
const results = [];
await Promise.all(
	Array.from({ length: parallel }, async () => {
		for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await job());
	}),
);

console.log("\nbraccio  pass   tempo medio  costo medio (relativo)  token medi opus / haiku (input+cacheW, cacheR, output)");
for (const arm of arms) {
	const mine = results.filter((r) => r.arm === arm);
	if (!mine.length) continue;
	const avg = (f) => mine.reduce((s, r) => s + f(r), 0) / mine.length;
	const tok = (model) => {
		const g = (k) => avg((r) => r.usage[model]?.[k] ?? 0);
		return `${Math.round(g("input") + g("cacheWrite"))}/${Math.round(g("cacheRead"))}/${Math.round(g("output"))}`;
	};
	console.log(`${arm.padEnd(8)} ${`${mine.filter((r) => r.pass).length}/${mine.length}`.padEnd(6)} ${`${Math.round(avg((r) => r.seconds))}s`.padEnd(12)} ${String(Math.round(avg((r) => r.cost))).padEnd(23)} ${tok("opus")} | ${tok("haiku")}`);
}
