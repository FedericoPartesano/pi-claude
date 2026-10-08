import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutAt } from "../workdir.mjs";

test("the work copy has the history up to base and no trace of later commits", async () => {
	const clone = mkdtempSync(join(tmpdir(), "clone-"));
	const sh = (command, cwd = clone) => execSync(command, { cwd, encoding: "utf8" }).trim();
	sh("git init -q -b main && git config user.email t@t && git config user.name t && echo bug > a.txt && git add . && git commit -qm base");
	const base = sh("git rev-parse HEAD");
	sh("echo fixed > a.txt && git commit -qam fix && git tag v2");
	const fix = sh("git rev-parse HEAD");
	const dir = join(mkdtempSync(join(tmpdir(), "work-")), "repo");
	checkoutAt(clone, base, dir);
	assert.equal(readFileSync(join(dir, "a.txt"), "utf8").trim(), "bug");
	assert.equal(sh("git log --all --format=%H", dir), base);
	assert.throws(() => sh(`git cat-file -e ${fix}`, dir), "the fix object is not in the work copy");
	assert.equal(sh("git status --porcelain", dir), "");
	const { existsSync } = await import("node:fs");
	assert.equal(existsSync(join(dir, ".git/FETCH_HEAD")), false, "no pointer back to the full clone");
});
