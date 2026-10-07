import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, filesOverlap, inScope, snapshotFiles } from "../src/scope.ts";

test("inScope: exact paths and folders ending with /", () => {
	assert.equal(inScope("src/cart.js", ["src/cart.js"]), true);
	assert.equal(inScope("./src/cart.js", ["src/cart.js"]), true);
	assert.equal(inScope("test/cart.test.js", ["test/"]), true);
	assert.equal(inScope("src/cart.jsx", ["src/cart.js"]), false);
	assert.equal(inScope("src/a.js", undefined), false);
});

test("filesOverlap: same file, file inside folder, or missing files (unknown scope overlaps everything)", () => {
	assert.equal(filesOverlap(["src/a.js"], ["src/b.js"]), false);
	assert.equal(filesOverlap(["src/a.js"], ["./src/a.js"]), true);
	assert.equal(filesOverlap(["src/"], ["src/a.js"]), true);
	assert.equal(filesOverlap(["src/a.js"], undefined), true);
	assert.equal(filesOverlap([], ["src/a.js"]), true);
});

test("changedPaths compares two snapshots", () => {
	const before = new Map([["a", "1"], ["b", "1"]]);
	const after = new Map([["a", "1"], ["b", "2"], ["c", "1"]]);
	assert.deepEqual(changedPaths(before, after).sort(), ["b", "c"]);
	assert.deepEqual(changedPaths(new Map([["gone", "1"]]), new Map()), ["gone"]);
});

test("snapshotFiles sees edits to clean and dirty files, and new files; undefined outside git", async () => {
	const directory = mkdtempSync(join(tmpdir(), "scope-"));
	assert.equal(await snapshotFiles(directory), undefined);
	execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: directory });
	writeFileSync(join(directory, "clean.js"), "1");
	writeFileSync(join(directory, "dirty.js"), "1");
	execSync("git add -A && git commit -qm init", { cwd: directory });
	writeFileSync(join(directory, "dirty.js"), "2");
	const before = (await snapshotFiles(directory))!;
	writeFileSync(join(directory, "dirty.js"), "3");
	writeFileSync(join(directory, "clean.js"), "2");
	writeFileSync(join(directory, "new.js"), "1");
	const after = (await snapshotFiles(directory))!;
	assert.deepEqual(changedPaths(before, after).sort(), ["clean.js", "dirty.js", "new.js"]);
});
