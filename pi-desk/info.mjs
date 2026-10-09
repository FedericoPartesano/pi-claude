/**
 * Facts for the header and the sidebar footer, read locally (no tokens): the project's git branch and changed files,
 * and the subscription usage pi-claude-code writes after every answer.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

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

/**
 * What "open outside" may open, from a viewer tab: web addresses in the browser, files of the project with their app.
 * Anything else outside the project is only shown in its folder (a script or a .desktop file is never launched).
 */
export function externalTarget(target, project) {
	if (typeof target !== "string" || !target) return {};
	if (/^https?:\/\//i.test(target)) return { url: target };
	if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(target)) return { url: `http://${target}` };
	if (/^[a-z][\w+.-]*:/i.test(target) && !/^file:\/\//i.test(target)) return {};
	const path = resolve(project, decodeURI(target.replace(/^file:\/\//i, "")));
	const inside = relative(project, path);
	return inside && !inside.startsWith("..") && !isAbsolute(inside) ? { path } : { reveal: path };
}

/** The session entry to fork from: the occurrence-th user message with this text (the last one if there are fewer). */
export function forkEntry(messages, text, occurrence) {
	const same = messages.filter((message) => message.text === text);
	return same[Math.min(occurrence, same.length - 1)]?.entryId;
}
