/**
 * Facts for the header and the sidebar footer, read locally (no tokens): the project's git branch and changed files,
 * and the subscription usage pi-claude-code writes after every answer.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_FILE = join(homedir(), ".pi", "agent", "claude-code-usage.json");

/** `git status --porcelain=v1 -b` → { branch, changes }; {} when there is nothing (not a repository). */
export function parseGitStatus(text) {
	const lines = text.split("\n").filter(Boolean);
	const head = lines[0]?.startsWith("## ") ? lines.shift().slice(3) : undefined;
	if (head === undefined) return {};
	const branch = head.replace(/^No commits yet on /, "").replace(/ \(no branch\)$/, "").split("...")[0].split(" ")[0];
	return { branch, changes: lines.length };
}

export function gitInfo(cwd) {
	return new Promise((resolve) => {
		execFile("git", ["status", "--porcelain=v1", "-b"], { cwd, timeout: 3000 }, (error, stdout) => resolve(error ? {} : parseGitStatus(stdout)));
	});
}

/** Percentages (0–100) of the 5-hour and 7-day windows; undefined when the file is missing or unreadable. */
export function readUsage(file = USAGE_FILE) {
	try {
		const usage = JSON.parse(readFileSync(file, "utf8"));
		const percent = (value) => (typeof value === "number" ? Math.round(value * 100) : undefined);
		return { fiveHour: percent(usage.fiveHourUtilization), sevenDay: percent(usage.sevenDayUtilization), overage: Boolean(usage.isUsingOverage), updatedAt: usage.updatedAt };
	} catch {
		return undefined;
	}
}
