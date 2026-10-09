import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, utimesSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStoreLock, withStoreLockAsync } from "../src/lock.ts";

test("withStoreLock waits for another process holding the store, then runs", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	const lockFile = new URL("../src/lock.ts", import.meta.url).href;
	const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withStoreLock } from ${JSON.stringify(lockFile)}; withStoreLock(${JSON.stringify(dir)}, () => { const end = Date.now() + 600; while (Date.now() < end); console.log("held"); });`], { stdio: ["ignore", "pipe", "inherit"] });
	// Listened to from the start: a child that exits while we wait for the lock must not be missed (it hung the suite).
	const closed = new Promise((resolve) => child.once("close", resolve));
	await Promise.race([new Promise((resolve) => child.stdout.once("data", resolve)), closed]);
	// The child prints "held" at the end of its section: start a bit before by racing it from the beginning instead.
	await closed;
	const started = Date.now();
	assert.equal(withStoreLock(dir, () => "done"), "done");
	assert.ok(Date.now() - started < 1000);
});

test("withStoreLock serialises with a holder that is still inside its section", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	const lockFile = new URL("../src/lock.ts", import.meta.url).href;
	const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withStoreLock } from ${JSON.stringify(lockFile)}; withStoreLock(${JSON.stringify(dir)}, () => { console.log("in"); const end = Date.now() + 700; while (Date.now() < end); });`], { stdio: ["ignore", "pipe", "inherit"] });
	// Listened to from the start: a child that exits while we wait for the lock must not be missed (it hung the suite).
	const closed = new Promise((resolve) => child.once("close", resolve));
	await Promise.race([new Promise((resolve) => child.stdout.once("data", resolve)), closed]);
	const started = Date.now();
	withStoreLock(dir, () => undefined);
	assert.ok(Date.now() - started >= 300, `did not wait (${Date.now() - started} ms)`);
	await closed;
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

test("withStoreLockAsync waits without blocking the event loop", async () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	const lockFile = new URL("../src/lock.ts", import.meta.url).href;
	const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withStoreLock } from ${JSON.stringify(lockFile)}; withStoreLock(${JSON.stringify(dir)}, () => { console.log("in"); const end = Date.now() + 500; while (Date.now() < end); });`], { stdio: ["ignore", "pipe", "inherit"] });
	// Listened to from the start: a child that exits while we wait for the lock must not be missed (it hung the suite).
	const closed = new Promise((resolve) => child.once("close", resolve));
	await Promise.race([new Promise((resolve) => child.stdout.once("data", resolve)), closed]);
	let ticks = 0;
	const timer = setInterval(() => ticks++, 10);
	await withStoreLockAsync(dir, () => undefined);
	clearInterval(timer);
	assert.ok(ticks >= 10, `event loop blocked while waiting (${ticks} ticks)`);
	await closed;
});

test("a holder whose lock was taken over does not release the new holder's lock", () => {
	const dir = mkdtempSync(join(tmpdir(), "lock-"));
	withStoreLock(dir, () => {
		// Someone forces the lock away (it looked stale) and takes it.
		rmSync(join(dir, ".lock"), { recursive: true, force: true });
		mkdirSync(join(dir, ".lock"));
		writeFileSync(join(dir, ".lock", "token"), "other");
	});
	assert.ok(existsSync(join(dir, ".lock")), "the other holder's lock is still there");
});
