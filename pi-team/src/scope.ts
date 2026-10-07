/**
 * File scopes of writer tasks: which declared files a path belongs to, whether two tasks may run at
 * the same time, and which files changed in the working tree (git) while a wave of tasks ran.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const normalize = (path: string) => path.replace(/^\.\//, "");

/** True when `path` is one of `files` or inside one of its folders (entries ending with "/"). */
export function inScope(path: string, files: string[] | undefined): boolean {
	const target = normalize(path);
	return (files ?? []).some((entry) => {
		const scope = normalize(entry);
		return scope.endsWith("/") ? target.startsWith(scope) : target === scope;
	});
}

/** Two tasks may run together only if both declare files and no file or folder overlaps. */
export function filesOverlap(a: string[] | undefined, b: string[] | undefined): boolean {
	if (!a?.length || !b?.length) return true;
	return a.some((entry) => inScope(entry, b)) || b.some((entry) => inScope(entry, a));
}

/** Content hash of every changed or untracked file in the git working tree; undefined outside git. */
export async function snapshotFiles(cwd: string): Promise<Map<string, string> | undefined> {
	const status = await new Promise<string | undefined>((resolve) =>
		execFile("git", ["status", "--porcelain", "-z", "-uall"], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout)),
	);
	if (status === undefined) return undefined;
	const snapshot = new Map<string, string>();
	const entries = status.split("\0").filter(Boolean);
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const path = entry.slice(3);
		// Renames carry the old path as the next entry.
		if (entry[0] === "R" || entry[0] === "C") index++;
		const content = await readFile(join(cwd, path)).catch(() => undefined);
		snapshot.set(path, content === undefined ? "deleted" : createHash("sha1").update(content).digest("hex"));
	}
	return snapshot;
}

/** Paths whose content differs between two snapshots (new, edited, reverted or deleted). */
export function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
	const changed = new Set<string>();
	for (const [path, hash] of after) if (before.get(path) !== hash) changed.add(path);
	for (const path of before.keys()) if (!after.has(path)) changed.add(path);
	return [...changed];
}
