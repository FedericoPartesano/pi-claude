/**
 * Leaner bash output for the model: ANSI codes out, repeated lines collapsed, very long lines cut; for long outputs the
 * head and tail with a pointer to the full output; for test suites the failures and the summary, with the passing tests
 * as a count. Returns undefined when the output should stay as it is.
 */

import { formatMatches, type Match } from "./search.ts";

const SEARCH_COMMAND = /^\s*(?:\w+=\S+\s+)*(?:grep|egrep|rg|git\s+grep)\b/;
const PASS_THROUGH = /^\s*(?:head|tail|sort|uniq)\b/;
const GREP_LINE = /^(.+?):(\d+)([:-])(.*)$/;

/**
 * Output of grep -n / rg -n run through bash, regrouped by file: the path once, then "line: text". Lossless (every line
 * the model asked for stays); undefined when the command or the output is not that.
 */
export function regroupGrep(text: string, command: string): string | undefined {
	const [first, ...rest] = command.split("|");
	if (!SEARCH_COMMAND.test(first) || !rest.every((segment) => PASS_THROUGH.test(segment))) return undefined;
	const lines = text.split("\n").filter((line) => line.trim());
	if (lines.length < 15) return undefined;
	const matches: Match[] = [];
	for (const line of lines) {
		const parsed = GREP_LINE.exec(line);
		if (!parsed) continue;
		matches.push({ path: parsed[1].replace(/^\.\//, ""), line: Number(parsed[2]), text: parsed[4], ...(parsed[3] === "-" ? { context: true } : {}) });
	}
	if (matches.length < lines.length * 0.9) return undefined;
	return formatMatches(matches, { perFile: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER, maxLine: 400 });
}

export interface BashContext {
	command: string;
	exitCode?: number;
	/** Where the full output is (Pi's own file when it truncated, or one the extension wrote). */
	fullOutputPath?: string;
}

const MIN_LINES = 120;
const FAILING_KEEP_UNDER = 300;
const HEAD = 40;
const TAIL = 60;
const MAX_LINE = 400;
const PASSING = [/^\s*✔\s/, /^\s*✓\s/, /^\s*√\s/, /^\s*ok \d+ - /, /^\s*PASS\s/, /\sPASSED\b/];
// node --test spec reporter group headers: noise once their passing tests are gone.
const GROUP_HEADER = /^\s*▶ /;
/** Summary lines of the runners: never cut. */
const SUMMARY_LINE = /^\s*ℹ (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) |^\s*(?:Test Files|Tests|Test Suites|Snapshots|Duration|Time):?\s|^# (?:tests|pass|fail) \d|^=+ .*\d+ (?:passed|failed)/;
const TEST_SUMMARY = /ℹ (?:pass|fail) \d|^\s*Tests?:?\s+.*\d+ (?:passed|failed)|\d+ (?:passed|failed)|^# (?:pass|fail) \d|^not ok \d/m;

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "");

function collapseRepeats(lines: string[]): string[] {
	const out: string[] = [];
	for (let index = 0; index < lines.length; ) {
		let run = 1;
		while (index + run < lines.length && lines[index + run] === lines[index]) run++;
		out.push(lines[index]);
		if (run >= 3) out.push(`[… la riga sopra si ripete altre ${run - 1} volte]`);
		else if (run === 2) out.push(lines[index]);
		index += run;
	}
	return out;
}

function headTail(lines: string[], head: number, tail: number, where?: string): string[] {
	if (lines.length <= head + tail) return lines;
	const omitted = lines.length - head - tail;
	return [...lines.slice(0, head), `[… ${omitted} righe omesse${where ? `: output completo in ${where}` : ""}]`, ...lines.slice(-tail)];
}

export function compactBash(text: string, { command, exitCode, fullOutputPath }: BashContext): string | undefined {
	if (/\bPI_LEAN_FULL=1\b/.test(command)) return undefined;
	let lines = stripAnsi(text).split("\n");
	if (lines.length <= MIN_LINES) return undefined;
	const passing = lines.filter((line) => PASSING.some((pattern) => pattern.test(line))).length;
	const isTestRun = passing >= 20 && TEST_SUMMARY.test(lines.join("\n"));
	// A failing command with a moderate output: the error may be anywhere, keep it whole (test runs keep failures anyway).
	if (exitCode && !isTestRun && lines.length < FAILING_KEEP_UNDER) return undefined;
	lines = collapseRepeats(lines.map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line)));
	if (isTestRun) {
		const kept: string[] = [];
		let marked = false;
		for (const line of lines) {
			if (GROUP_HEADER.test(line)) continue;
			if (!PASSING.some((pattern) => pattern.test(line))) kept.push(line);
			else if (!marked) {
				kept.push(`[${passing} test passati omessi]`);
				marked = true;
			}
		}
		if (kept.length <= 210) return kept.join("\n");
		// Failures with their details first, generously; the summary lines always, wherever they were.
		const summary = kept.filter((line) => SUMMARY_LINE.test(line));
		const head = kept.slice(0, 150);
		const tail = kept.slice(-40).filter((line) => !summary.includes(line));
		return [...head, `[… ${kept.length - 150 - tail.length} righe omesse${fullOutputPath ? `: output completo in ${fullOutputPath}` : ""}]`, ...summary.filter((line) => !head.includes(line)), ...tail].join("\n");
	}
	return headTail(lines, HEAD, TAIL, fullOutputPath).join("\n");
}
