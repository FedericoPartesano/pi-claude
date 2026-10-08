// Work copies for round-2 jobs.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

/** A repo at `base` with only the history up to it: later commits (the fix) are nowhere to be found. */
export function checkoutAt(clone, base, dir) {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	execSync(`git init -q && git fetch -q --no-tags ${JSON.stringify(clone)} ${base}:refs/heads/main && git checkout -q main`, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
}
