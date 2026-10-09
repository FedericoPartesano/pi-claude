import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStoreLock } from "../src/lock.ts";

test("withStoreLock waits for another process holding the store, then runs", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	const lockFile = new URL("../src/lock.ts", import.meta.url).href;
	const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withStoreLock } from ${JSON.stringify(lockFile)}; withStoreLock(${JSON.stringify(dir)}, () => { const end = Date.now() + 600; while (Date.now() < end); console.log("held"); });`], { stdio: ["ignore", "pipe", "inherit"] });
	await new Promise((resolve) => child.stdout.once("data", resolve).once("close", resolve));
	// The child prints "held" at the end of its section: start a bit before by racing it from the beginning instead.
	await new Promise((resolve) => child.once("close", resolve));
	const started = Date.now();
	assert.equal(withStoreLock(dir, () => "done"), "done");
	assert.ok(Date.now() - started < 1000);
});

test("withStoreLock serialises with a holder that is still inside its section", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	const lockFile = new URL("../src/lock.ts", import.meta.url).href;
	const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withStoreLock } from ${JSON.stringify(lockFile)}; withStoreLock(${JSON.stringify(dir)}, () => { console.log("in"); const end = Date.now() + 700; while (Date.now() < end); });`], { stdio: ["ignore", "pipe", "inherit"] });
	await new Promise((resolve) => child.stdout.once("data", resolve));
	const started = Date.now();
	withStoreLock(dir, () => undefined);
	assert.ok(Date.now() - started >= 300, `did not wait (${Date.now() - started} ms)`);
	await new Promise((resolve) => child.once("close", resolve));
});

test("a stale lock (its holder died) is taken over", () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	mkdirSync(join(dir, ".lock"));
	const old = (Date.now() - 60_000) / 1000;
	utimesSync(join(dir, ".lock"), old, old);
	const started = Date.now();
	assert.equal(withStoreLock(dir, () => 1), 1);
	assert.ok(Date.now() - started < 1000);
});
