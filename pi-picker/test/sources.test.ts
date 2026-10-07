import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childrenAt, dirsSource, listProjectPaths, projectsSource, readRecentProjects, underLocation } from "../src/sources.ts";

const PATHS = ["README.md", ".github/ci.yml", "src/a.ts", "src/lib/b.ts", "src/lib/c.ts", "test/a.test.ts"];

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-picker-"));
}

function write(root: string, path: string, content = "x"): void {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), content);
}

test("childrenAt lists folders first, then files, of one level", () => {
	assert.deepEqual(
		childrenAt(PATHS, "").map((item) => [item.label, item.value, item.enter, item.hidden]),
		[
			[".github/", ".github/", ".github", true],
			["src/", "src/", "src", false],
			["test/", "test/", "test", false],
			["README.md", "README.md", undefined, false],
		],
	);
	assert.deepEqual(childrenAt(PATHS, "src").map((item) => item.label), ["lib/", "a.ts"]);
	assert.deepEqual(childrenAt(PATHS, "src/lib").map((item) => item.value), ["src/lib/b.ts", "src/lib/c.ts"]);
});

test("underLocation lists every file and folder below a location, as project paths", () => {
	assert.deepEqual(underLocation(PATHS, "src").map((item) => item.label), ["src/lib/", "src/a.ts", "src/lib/b.ts", "src/lib/c.ts"]);
	assert.equal(underLocation(PATHS, "").length, PATHS.length + 4); // 4 folders: .github, src, src/lib, test
});

test("listProjectPaths walks a plain folder without node_modules and .git", () => {
	const root = tempDir();
	for (const path of ["a.txt", "src/b.ts", "node_modules/x/index.js", ".git/HEAD", ".env"]) write(root, path);
	assert.deepEqual(listProjectPaths(root).sort(), [".env", "a.txt", "src/b.ts"]);
	assert.equal(listProjectPaths(root, 2).length, 2);
});

test("listProjectPaths uses git: tracked and untracked files, not ignored ones", () => {
	const root = tempDir();
	execFileSync("git", ["init", "-q"], { cwd: root });
	for (const path of ["tracked.ts", "untracked.ts", "dist/out.js", ".gitignore"]) write(root, path, path === ".gitignore" ? "dist/\n" : "x");
	execFileSync("git", ["add", "tracked.ts", ".gitignore"], { cwd: root });
	assert.deepEqual(listProjectPaths(root).sort(), [".gitignore", "tracked.ts", "untracked.ts"]);
});

test("readRecentProjects reads the cwd of each session folder, newest first, existing folders only", () => {
	const sessions = tempDir();
	const projectA = tempDir();
	const projectB = tempDir();
	const session = (folder: string, file: string, cwd: string, seconds: number) => {
		write(sessions, `${folder}/${file}`, `${JSON.stringify({ type: "session", version: 3, id: file, timestamp: "2026-10-01T00:00:00Z", cwd })}\n{"type":"x"}\n`);
		utimesSync(join(sessions, folder, file), seconds, seconds);
	};
	session("a", "1.jsonl", projectA, 1000);
	session("a", "2.jsonl", projectA, 3000);
	session("b", "1.jsonl", projectB, 2000);
	session("gone", "1.jsonl", join(projectA, "deleted"), 4000);
	write(sessions, "broken/1.jsonl", "not json\n");

	const recent = readRecentProjects(sessions);
	assert.deepEqual(recent.map((project) => project.path), [projectA, projectB]);
	assert.equal(recent[0].lastUsed, 3000 * 1000);
	assert.deepEqual(readRecentProjects(join(sessions, "missing")), []);
});

test("dirsSource lists only folders, with the current folder first", async () => {
	const root = tempDir();
	for (const path of ["b/x", "a/x", ".hidden/x", "file.txt"]) write(root, path);
	const source = dirsSource(root);
	const items = await source.list(root);
	assert.deepEqual(items.map((item) => [item.label, item.hidden]), [["./ (questa cartella)", false], [".hidden/", true], ["a/", false], ["b/", false]]);
	assert.equal(items[0].value, root);
	assert.equal(items[2].enter, join(root, "a"));
	assert.equal(source.parent?.(join(root, "a")), root);
});

test("projectsSource starts from recent projects plus a browse entry", async () => {
	const sessions = tempDir();
	const project = tempDir();
	write(sessions, "p/1.jsonl", `${JSON.stringify({ type: "session", cwd: project })}\n`);
	const home = tempDir();
	const source = projectsSource(sessions, home);
	const items = await source.list(source.start);
	assert.equal(items[0].value, project);
	assert.equal(items[0].enter, project);
	assert.equal(items.at(-1)?.enter, home);
	assert.equal(source.parent?.(source.start), undefined);
});
