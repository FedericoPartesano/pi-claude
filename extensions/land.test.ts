import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLandLock, defaultChecks, land } from "./land/land.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A repo on main (the "live checkout") and a worktree on a feature branch, like pi-claude and pi-claude-mem. */
function setup() {
	const root = mkdtempSync(join(tmpdir(), "land-"));
	const live = join(root, "live");
	mkdirSync(live);
	git(live, "init", "-q", "-b", "main");
	git(live, "config", "user.email", "t@t");
	git(live, "config", "user.name", "t");
	writeFileSync(join(live, "a.txt"), "1\n");
	writeFileSync(join(live, "b.txt"), "1\n");
	git(live, "add", ".");
	git(live, "commit", "-qm", "init");
	const work = join(root, "work");
	git(live, "worktree", "add", "-q", "-b", "feat", work);
	return { live, work };
}

const commit = (cwd: string, file: string, content: string, message: string) => {
	writeFileSync(join(cwd, file), content);
	git(cwd, "add", file);
	git(cwd, "commit", "-qm", message);
};

test("rebases onto main, runs the checks and fast-forwards main (the live checkout follows)", async () => {
	const { live, work } = setup();
	commit(live, "b.txt", "2\n", "main moved");
	commit(work, "a.txt", "2\n", "feature");
	const result = await land({ cwd: work, onto: "main", checks: ["test \"$(cat a.txt)\" = 2 && test \"$(cat b.txt)\" = 2"] });
	assert.equal(result.ok, true, result.message);
	assert.equal(git(live, "log", "-1", "--format=%s"), "feature");
	assert.equal(readFileSync(join(live, "a.txt"), "utf8"), "2\n");
	assert.equal(git(live, "status", "--porcelain"), "");
});

test("red checks: nothing lands and the branch is put back as it was", async () => {
	const { live, work } = setup();
	commit(live, "b.txt", "2\n", "main moved");
	commit(work, "a.txt", "2\n", "feature");
	const before = git(work, "rev-parse", "HEAD");
	const result = await land({ cwd: work, onto: "main", checks: ["exit 1"] });
	assert.equal(result.ok, false);
	assert.match(result.message, /exit 1/);
	assert.equal(git(work, "rev-parse", "HEAD"), before);
	assert.equal(git(live, "log", "-1", "--format=%s"), "main moved");
});

test("a conflict aborts the rebase and names the files", async () => {
	const { live, work } = setup();
	commit(live, "a.txt", "main\n", "main edits a");
	commit(work, "a.txt", "feat\n", "feature edits a");
	const before = git(work, "rev-parse", "HEAD");
	const result = await land({ cwd: work, onto: "main", checks: [] });
	assert.equal(result.ok, false);
	assert.match(result.message, /a\.txt/);
	assert.equal(git(work, "rev-parse", "HEAD"), before);
	assert.ok(!existsSync(join(git(work, "rev-parse", "--git-dir"), "rebase-merge")));
});

test("refuses a dirty tree, and never touches a dirty live checkout", async () => {
	const { live, work } = setup();
	commit(work, "a.txt", "2\n", "feature");
	writeFileSync(join(work, "b.txt"), "uncommitted\n");
	assert.match((await land({ cwd: work, onto: "main", checks: [] })).message, /non committate/);
	git(work, "checkout", "--", "b.txt");
	writeFileSync(join(live, "b.txt"), "someone is editing\n");
	const result = await land({ cwd: work, onto: "main", checks: [] });
	assert.equal(result.ok, false);
	assert.match(result.message, /modifiche non committate/);
	assert.equal(git(live, "log", "-1", "--format=%s"), "init");
});

test("main not checked out anywhere: the ref moves (compare-and-swap)", async () => {
	const { live, work } = setup();
	git(live, "checkout", "-q", "-b", "other");
	commit(work, "a.txt", "2\n", "feature");
	const result = await land({ cwd: work, onto: "main", checks: [] });
	assert.equal(result.ok, true, result.message);
	assert.equal(git(live, "log", "-1", "--format=%s", "main"), "feature");
});

test("sessions queue on one lock; a dead owner's lock is taken over", async () => {
	const { work } = setup();
	const first = await acquireLandLock(work, { pollMs: 10, waitMs: 1000 });
	assert.ok(first);
	let secondGot = false;
	const second = acquireLandLock(work, { pollMs: 10, waitMs: 2000 }).then((lock) => {
		secondGot = true;
		return lock;
	});
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(secondGot, false);
	first!.release();
	const lock = await second;
	assert.ok(lock);
	lock!.release();
	// A lock left by a process that no longer exists does not block forever.
	const dir = join(git(work, "rev-parse", "--git-common-dir"), "pi-land.lock");
	mkdirSync(dir);
	writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: 999999, at: Date.now() }));
	const taken = await acquireLandLock(work, { pollMs: 10, waitMs: 500 });
	assert.ok(taken);
	taken!.release();
});

test("default checks come from package.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "land-pkg-"));
	assert.deepEqual(defaultChecks(dir), []);
	writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
	assert.deepEqual(defaultChecks(dir), ["npm test"]);
	writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
	assert.deepEqual(defaultChecks(dir), []);
});

test("/land arguments", async () => {
	const { parseLandArgs } = await import("./land.ts");
	assert.deepEqual(parseLandArgs(`--check "npm test" --check 'npx tsc -p .' --onto develop`), { checks: ["npm test", "npx tsc -p ."], onto: "develop" });
	assert.deepEqual(parseLandArgs(""), { checks: [], onto: undefined });
	assert.ok("error" in parseLandArgs("main"));
});
