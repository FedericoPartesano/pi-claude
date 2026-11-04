/**
 * One adapter per test runner. An adapter says whether a command is its runner, how to make the run readable while it
 * is still going (extra flags, a reporter file), and how to read the progress from the text it produced. A new runner is
 * one entry in RUNNERS: nothing else needs to know about it.
 *
 * Where the text comes from (`source`): "output" is the runner's own stdout (read from a `| tee` file when the command
 * pipes it into tail/grep, else from the tool's partial output); "reporter" is a file the runner is told to write.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collect, estimateTotal, type Progress } from "./progress.ts";

export interface PrepareContext {
	/** File the reporter writes to, when the runner uses source "reporter". */
	log: string;
	/** Where helper files (a reporter script) may be written. */
	helper: string;
	cwd: string;
}

export interface Runner {
	name: string;
	source: "output" | "reporter";
	matches(command: string): boolean;
	/** The command with the flags this runner needs, and the helper files to write first; undefined = leave as is. */
	prepare?(command: string, ctx: PrepareContext): { command: string; files?: Record<string, string> } | undefined;
	parse(text: string): Progress;
	estimate(command: string, cwd: string): number | undefined;
}

const stripDuration = (name: string) => name.replace(/\s+\(?[\d.]+\s*m?s\)?$/, "");

/** node:test spec reporter and TAP. */
export const nodeParse = (text: string) => {
	// The failing-tests list at the end repeats the failures already counted above it.
	const end = text.search(/^\s*✖ failing tests:/m);
	return nodeParseBody(end < 0 ? text : text.slice(0, end));
};
const nodeParseBody = (text: string) =>
	collect(text, (line, ok, ko) => {
		let match: RegExpExecArray | null;
		// A summary line ("ℹ pass 3", "# fail 0") is not a test.
		if (/^(?:ℹ|#)\s/.test(line)) return;
		if ((match = /^(?:✔|✓|√)\s+(.+)$/.exec(line))) ok(stripDuration(match[1]));
		else if ((match = /^(?:✖|✕|×)\s+(?!failing tests)(.+)$/.exec(line))) ko(stripDuration(match[1]));
		else if ((match = /^ok \d+ - (.+)$/.exec(line))) ok(match[1]);
		else if ((match = /^not ok \d+ - (.+)$/.exec(line))) ko(match[1]);
	});

/** vitest `--reporter=verbose`: "✓ file > suite > name 2ms", "× …", skipped "↓ …" ignored. */
export const vitestParse = (text: string) =>
	collect(text, (line, ok, ko) => {
		let match: RegExpExecArray | null;
		if ((match = /^(?:✓|✔)\s+(.+? > .+)$/.exec(line))) ok(stripDuration(match[1]));
		else if ((match = /^(?:×|✗|✖)\s+(.+? > .+)$/.exec(line))) ko(stripDuration(match[1]));
	});

/** pytest -v: "path::test PASSED", "path::test FAILED". */
export const pytestParse = (text: string) =>
	collect(text, (line, ok, ko) => {
		let match: RegExpExecArray | null;
		if ((match = /^(\S+::\S+)\s+PASSED\b/.exec(line))) ok(match[1]);
		else if ((match = /^(\S+::\S+)\s+FAILED\b/.exec(line))) ko(match[1]);
	});

/** jest reporter file: one "@@ok name" or "@@ko name" line per finished test. */
export const jestParse = (text: string) =>
	collect(text, (line, ok, ko) => {
		if (line.startsWith("@@ok ")) ok(line.slice(5));
		else if (line.startsWith("@@ko ")) ko(line.slice(5));
	});

/** Playwright `--reporter=list`: "✓  1 [chromium] › a.spec.ts:3:5 › title (12ms)", failures "✘  2 …", skipped "-  3 …" ignored. */
export const playwrightParse = (text: string) =>
	collect(text, (line, ok, ko) => {
		let match: RegExpExecArray | null;
		if ((match = /^(?:✓|✔)\s+\d+\s+(.+)$/.exec(line))) ok(stripDuration(match[1]));
		else if ((match = /^(?:✘|✗|×|✖)\s+\d+\s+(.+)$/.exec(line))) ko(stripDuration(match[1]));
	});

/** Cypress spec reporter: "✓ name (12ms)" per passed test, "1) name" per failure (numbered again in the detail list: counted once). */
export const cypressParse = (text: string) => {
	const failedNumbers = new Set<string>();
	return collect(text, (line, ok, ko) => {
		let match: RegExpExecArray | null;
		// The closing banner ("✔  All specs passed!", "✖  1 of 2 failed") is not a test.
		if (/^(?:✔|✖)\s+(?:All specs|\d+ of \d+)/.test(line)) return;
		if ((match = /^(?:✓|✔)\s+(.+)$/.exec(line))) ok(stripDuration(match[1]));
		else if ((match = /^(\d+)\)\s+(.+)$/.exec(line)) && !failedNumbers.has(match[1])) {
			failedNumbers.add(match[1]);
			ko(match[2]);
		}
	});
};

/** The parser that finds most results: for commands like `npm test` where the runner is behind a script. */
const bestOf = (text: string) => [nodeParse(text), vitestParse(text), pytestParse(text), playwrightParse(text), cypressParse(text)].reduce((a, b) => (b.results.length > a.results.length ? b : a));

const hasFlag = (command: string, pattern: RegExp) => pattern.test(command);

/** A project that sets its own jest reporters: do not override them. */
function jestConfigReporters(cwd: string): boolean {
	for (const name of ["package.json", "jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts", "jest.config.json"]) {
		try {
			const file = join(cwd, name);
			if (existsSync(file) && /["']?reporters["']?\s*:/.test(readFileSync(file, "utf8"))) return true;
		} catch {}
	}
	return false;
}

/** Reporter script jest loads: appends a line per finished test to `log` (skipped and todo tests are not results). */
export const jestReporterSource = (log: string) =>
	[
		`const fs = require("fs");`,
		`const LOG = ${JSON.stringify(log)};`,
		`module.exports = class PiTestMonitorReporter {`,
		`  onTestCaseResult(_test, result) {`,
		`    if (result.status !== "passed" && result.status !== "failed") return;`,
		`    try { fs.appendFileSync(LOG, (result.status === "passed" ? "@@ok " : "@@ko ") + String(result.fullName || result.title).replace(/\\s+/g, " ") + "\\n"); } catch {}`,
		`  }`,
		`};`,
		``,
	].join("\n");

export const RUNNERS: Runner[] = [
	{
		name: "node:test",
		source: "output",
		matches: (command) => /\bnode\s+(?:\S+\s+)*--test\b/.test(command),
		parse: nodeParse,
		estimate: estimateTotal,
	},
	{
		name: "vitest",
		source: "output",
		matches: (command) => /\bvitest\b/.test(command),
		// The default reporter prints only a summary when piped; verbose prints a line per test.
		prepare: (command) => (hasFlag(command, /--reporter\b|--reporter=/) ? undefined : { command: command.replace(/\bvitest(?:\s+run)?\b/, (match) => `${match} --reporter=verbose`) }),
		parse: vitestParse,
		estimate: estimateTotal,
	},
	{
		name: "jest",
		source: "reporter",
		matches: (command) => /\bjest\b/.test(command),
		// A reporter file is the only live per-test signal jest gives; `default` keeps the output the model reads.
		prepare: (command, ctx) => {
			if (hasFlag(command, /--reporters?\b|--json\b/) || jestConfigReporters(ctx.cwd)) return undefined;
			const script = join(ctx.helper, "jest-reporter.cjs");
			// --reporters takes several values and would swallow a test path after it: append it at the end of the jest stage.
			const at = command.search(/\s(?:\d?>|&>|\||&&|;)/);
			const flags = ` --reporters=default --reporters='${script}'`;
			const out = at < 0 ? command + flags : command.slice(0, at) + flags + command.slice(at);
			return { command: out, files: { [script]: jestReporterSource(ctx.log) } };
		},
		parse: jestParse,
		estimate: estimateTotal,
	},
	{
		name: "pytest",
		source: "output",
		matches: (command) => /\bpytest\b/.test(command),
		parse: pytestParse,
		estimate: estimateTotal,
	},
	{
		name: "playwright",
		source: "output",
		matches: (command) => /\bplaywright\s+test\b/.test(command),
		// The default reporter is `dot` on CI and without a terminal: `list` prints one line per test.
		prepare: (command) => (hasFlag(command, /--reporter\b/) ? undefined : { command: command.replace(/\bplaywright\s+test\b/, (match) => `${match} --reporter=list`) }),
		parse: playwrightParse,
		estimate: estimateTotal,
	},
	{
		name: "cypress",
		source: "output",
		matches: (command) => /\bcypress\s+run\b/.test(command),
		parse: cypressParse,
		estimate: estimateTotal,
	},
	{
		// `npm test`, `pnpm test`, `yarn test`, `bun test`: the runner is behind the script, so read whatever format shows up.
		name: "script",
		source: "output",
		matches: (command) => /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|e2e|test:e2e)\b/.test(command),
		parse: bestOf,
		estimate: estimateTotal,
	},
];

export const detectRunner = (command: string): Runner | undefined => (command.includes("\n") ? undefined : RUNNERS.find((runner) => runner.matches(command)));
