/**
 * What a test run has produced so far, and the shared helpers the runners (runners.ts) build on: ANSI stripping, the
 * progress record, the `| tee` rewrite and the static estimate of how many tests a command will run.
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Progress {
	pass: number;
	fail: number;
	last?: string;
	/** One entry per finished test, in order ("p" passed, "f" failed). */
	results: ("p" | "f")[];
	/** Names of the failed tests, in order. */
	failed: string[];
}

export const emptyProgress = (): Progress => ({ pass: 0, fail: 0, results: [], failed: [] });

export const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** Builds a Progress from per-test events; `line` callbacks call `ok`/`ko`. */
export function collect(text: string, read: (line: string, ok: (name: string) => void, ko: (name: string) => void) => void): Progress {
	const progress = emptyProgress();
	const ok = (name: string) => (progress.pass++, progress.results.push("p"), (progress.last = name));
	const ko = (name: string) => (progress.fail++, progress.results.push("f"), progress.failed.push(name), (progress.last = name));
	for (const raw of stripAnsi(text).split("\n")) read(raw.trim(), ok, ko);
	return progress;
}

const FILTER = /^(?:tail|head|grep|egrep|rg|sed|awk|cut|tr)\b/;

/** `cmd | tail -5` → `cmd | tee 'file' | tail -5` for a one-line command; otherwise undefined (nothing to change). */
export function teeBeforeFilter(command: string, file: string): string | undefined {
	if (command.includes("\n")) return undefined;
	let quote = "";
	const pipes: number[] = [];
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			if (char === quote) quote = "";
		} else if (char === "'" || char === '"') quote = char;
		else if (char === "|" && command[i + 1] !== "|" && command[i - 1] !== "|" && command[i - 1] !== ">") pipes.push(i);
	}
	// The first pipe whose next stage is a filter: everything before it is the test run.
	for (const at of pipes) {
		if (!FILTER.test(command.slice(at + 1).trim())) continue;
		if (/\btee\b/.test(command.slice(0, at))) return undefined;
		return `${command.slice(0, at).trimEnd()} | tee '${file.replace(/'/g, "'\\''")}' ${command.slice(at)}`;
	}
	return undefined;
}

/**
 * `cd d; timeout 600 npx vitest run x > /tmp/run.log 2>&1; grep …`: the file the test stage writes to (the tool shows
 * nothing while it runs, the file is the only live signal). One-line commands only; the working directory follows `cd`
 * statements; undefined when the stage has no plain redirect, the path needs the shell (`$VAR`, `~`) or is /dev/null.
 */
export function redirectedLog(command: string, cwd: string, isRunner: (stage: string) => boolean): string | undefined {
	if (command.includes("\n")) return undefined;
	let dir = cwd;
	for (const stage of command.split(/&&|;/)) {
		const text = stage.trim();
		const move = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/.exec(text);
		if (move) {
			const target = move[1] ?? move[2] ?? move[3]!;
			if (/[$~`*]/.test(target)) return undefined;
			dir = resolve(dir, target);
			continue;
		}
		if (!isRunner(text) || /\|(?!\|)/.test(text.replace(/\|\|/g, ""))) continue;
		const target = /(?:^|\s)(?:&>>?|1?>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s&|;<>]+))/.exec(text);
		if (!target) return undefined;
		const file = target[1] ?? target[2] ?? target[3]!;
		if (file === "/dev/null" || /[$~`*]/.test(file)) return undefined;
		return resolve(dir, file);
	}
	return undefined;
}

/** Rows of a `.each([...])` table counted from the literal on the same line; 1 when it cannot be read. */
function eachRows(table: string): number {
	const inner = table.trim();
	if (!inner) return 1;
	const rows = (inner.match(/\[/g) ?? []).length;
	if (rows > 0) return rows;
	return inner.split(",").filter((part) => part.trim()).length || 1;
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_\w+\.py$|_test\.py$|_test\.go$/;

/**
 * Estimated number of tests, counted in the test files named in the command (globs allowed; a leading `cd dir &&` is
 * followed). A static count: loops that generate tests are counted once, so the monitor grows the total when more
 * results arrive. Undefined when no file is named or nothing is found.
 */
export function estimateTotal(command: string, cwd: string): number | undefined {
	const dir = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "");
	const base = dir ? resolve(cwd, dir) : cwd;
	const files = new Set<string>();
	for (const token of command.split(/[\s|&;]+/)) {
		const bare = token.replace(/^["']|["']$/g, "");
		if (!TEST_FILE.test(bare) && !/[*?].*\.(?:[cm]?[jt]sx?|py|go)$/.test(bare)) continue;
		try {
			for (const file of globSync(bare, { cwd: base })) files.add(resolve(base, file));
		} catch {}
	}
	let total = 0;
	for (const file of files) {
		try {
			const source = readFileSync(file, "utf8");
			for (const line of source.split("\n")) {
				const each = /^\s*(?:test|it|describe)(?:\.\w+)*\.each\(\s*\[(.*)\]\s*\)\s*\(/.exec(line);
				if (each && !/^\s*describe/.test(line)) total += eachRows(each[1]);
				else if (/^\s*(?:test|it)(?:\.\w+)*\(|^\s*(?:async\s+)?def test_|^func Test\w+\(/.test(line)) total++;
			}
		} catch {}
	}
	return total > 0 ? total : undefined;
}
