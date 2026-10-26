/**
 * The bug package: everything that helps to understand what happened, written as plain files in one folder:
 *   report.json   the form, date, Pi and Node versions, model, working folder, git state, PI_* settings
 *   session.jsonl the whole session file (all branches)    branch.json  the active branch, as the model saw it
 *   system-prompt.txt, todo.json, memory/ (project and global), intents/, crashes.json
 * The folder is kept whole on disk. `redactedCopy` makes the one that is sent: same files, secrets hidden.
 */
import { execFileSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { redact, SECRET_NAME } from "./redact.ts";

export interface BugForm {
	/** "crash": made from an entry of crashes.json at startup. */
	kind?: "bug" | "crash";
	title: string;
	happened: string;
	expected: string;
	severity: "blocca" | "fastidio" | "piccolo";
	redact: boolean;
	send: boolean;
}

export interface BugSources {
	cwd: string;
	home: string;
	form: BugForm;
	piVersion: string;
	/** The crash entry this package is about (kind "crash"). */
	crash?: unknown;
	/** Folder of this extension (pi-claude): its package.json version and git commit go in the report. */
	extensionRoot?: string;
	model?: string;
	sessionId?: string;
	sessionFile?: string;
	branch: unknown[];
	systemPrompt?: string;
	env: NodeJS.ProcessEnv;
	now: Date;
}

export const slug = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bug";

const git = (cwd: string, args: string[]) => {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
};

/** Version, commit and date of the extension itself, so a report says which copy of it was running. */
export function extensionInfo(root: string | undefined): { name?: string; version?: string; commit?: string; committedAt?: string } {
	if (!root) return {};
	let pkg: { name?: string; version?: string } = {};
	try {
		pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	} catch {
		// not a package folder: git info only
	}
	return { name: pkg.name, version: pkg.version, commit: git(root, ["rev-parse", "--short", "HEAD"]) || undefined, committedAt: git(root, ["log", "-1", "--format=%cI"]) || undefined };
}

/** The last todo list on the branch (what the panel shows), or undefined. */
export function lastTodo(branch: unknown[]): unknown {
	let found: unknown;
	for (const entry of branch) {
		const message = (entry as { message?: { role?: string; toolName?: string; details?: unknown } }).message;
		if (message?.role === "toolResult" && message.toolName === "todo") found = message.details;
	}
	return found;
}

const copyIfThere = (from: string, to: string) => {
	if (!existsSync(from)) return;
	mkdirSync(dirname(to), { recursive: true });
	cpSync(from, to, { recursive: true, dereference: true });
};

/** Writes the package into `parent/<date>-<title>` and returns its folder. */
export function writeBundle(parent: string, s: BugSources): string {
	const stamp = s.now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const dir = join(parent, `${stamp}-${slug(s.form.title)}`);
	mkdirSync(dir, { recursive: true });
	const json = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");

	const settings = Object.fromEntries(Object.entries(s.env).filter(([name]) => /^(PI_|CLAUDE_CODE_)/.test(name)).map(([name, value]) => [name, SECRET_NAME.test(name) ? "[nascosto]" : value]));
	json("report.json", {
		reportedAt: s.now.toISOString(),
		form: s.form,
		crash: s.crash,
		pi: s.piVersion,
		extension: extensionInfo(s.extensionRoot),
		node: process.version,
		platform: process.platform,
		model: s.model,
		sessionId: s.sessionId,
		cwd: s.cwd,
		git: { branch: git(s.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), head: git(s.cwd, ["rev-parse", "--short", "HEAD"]), status: git(s.cwd, ["status", "--short"]).split("\n").slice(0, 60) },
		settings,
	});
	json("branch.json", s.branch);
	json("todo.json", lastTodo(s.branch) ?? null);
	if (s.systemPrompt) writeFileSync(join(dir, "system-prompt.txt"), s.systemPrompt);
	if (s.sessionFile) copyIfThere(s.sessionFile, join(dir, "session.jsonl"));

	const agent = join(s.home, ".pi", "agent");
	for (const name of ["memory", "memory.md", "memory-archive.md", "dream-last.json"]) copyIfThere(join(s.cwd, ".pi", name), join(dir, "memory", "project", name));
	for (const name of ["memory", "memory.md"]) copyIfThere(join(agent, name), join(dir, "memory", "global", name));
	copyIfThere(join(s.cwd, "intents"), join(dir, "intents"));
	// Only the last week of crashes: older ones say nothing about this problem and carry paths of other projects.
	try {
		const week = s.now.getTime() - 7 * 86_400_000;
		const all = JSON.parse(readFileSync(join(agent, "crashes.json"), "utf8")) as { timestamp?: string }[];
		const recent = all.filter((entry) => Date.parse(entry.timestamp ?? "") >= week);
		if (recent.length) json("crashes.json", recent);
	} catch {
		// no crash log
	}
	return dir;
}

const TEXT = /\.(jsonl?|md|txt|log)$/i;

function walk(from: string, to: string) {
	mkdirSync(to, { recursive: true });
	for (const name of readdirSync(from)) {
		const source = join(from, name);
		const target = join(to, name);
		if (statSync(source).isDirectory()) walk(source, target);
		else if (TEXT.test(name)) writeFileSync(target, redact(readFileSync(source, "utf8")));
		else cpSync(source, target);
	}
}

/** Same package with secrets hidden in every text file; returns the new folder (next to the first, "-oscurato"). */
export function redactedCopy(dir: string): string {
	const target = `${dir}-oscurato`;
	walk(dir, target);
	return target;
}

/** Largest session.jsonl sent as is; the server refuses packages over 50 MB (BUG_MAX_MB) and a long session can pass that. */
export const SESSION_CAP_BYTES = Number(process.env.PI_BUG_SESSION_MB) > 0 ? Number(process.env.PI_BUG_SESSION_MB) * 1024 * 1024 : 20 * 1024 * 1024;

/**
 * Folder to send: `dir` itself when session.jsonl fits under `maxBytes`, otherwise a copy ("-ridotto") whose session.jsonl
 * keeps only the last `maxBytes`, cut at a line boundary, after a first line saying how much was left out.
 * `branch.json` stays whole, and the folder on disk is never touched.
 */
export function trimSession(dir: string, maxBytes = SESSION_CAP_BYTES): string {
	const file = join(dir, "session.jsonl");
	if (!existsSync(file)) return dir;
	const size = statSync(file).size;
	if (size <= maxBytes) return dir;
	const target = `${dir}-ridotto`;
	cpSync(dir, target, { recursive: true });
	const tail = Buffer.alloc(maxBytes);
	const fd = openSync(file, "r");
	try {
		readSync(fd, tail, 0, maxBytes, size - maxBytes);
	} finally {
		closeSync(fd);
	}
	const start = tail.indexOf(10) + 1; // drop the cut line
	const omittedBytes = size - (maxBytes - start);
	writeFileSync(join(target, "session.jsonl"), JSON.stringify({ type: "troncato", omittedBytes, originalBytes: size }) + "\n" + tail.subarray(start).toString("utf8"));
	return target;
}

export const folderName = (dir: string) => basename(dir);
