import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname } from "node:path";
import { startAskpass } from "./askpass.ts";

// spawnSync would block the event loop that serves the socket: use async spawn.
import { spawn } from "node:child_process";
const run = (script: string, args: string[]) => new Promise<{ code: number | null; out: string }>((resolve) => {
	const child = spawn(script, args, { stdio: ["ignore", "pipe", "ignore"] });
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	child.on("close", (code) => resolve({ code, out }));
});

test("askpass answers only inside a grant, with the provided password; private dir and 0700 script", { skip: process.platform === "win32" }, async () => {
	const a = await startAskpass();
	assert.ok(a);
	try {
		assert.equal(statSync(dirname(a.script)).mode & 0o777, 0o700);
		assert.equal(statSync(a.script).mode & 0o777, 0o700);
		const idle = await run(a.script, ["[sudo] password for x: "]);
		assert.equal(idle.code, 1);
		assert.equal(idle.out, "");
		const release = a.grant(() => "r00t pw");
		const granted = await run(a.script, ["[sudo] password for x: "]);
		assert.equal(granted.code, 0);
		assert.equal(granted.out, "r00t pw\n");
		release();
		assert.equal((await run(a.script, ["p"])).code, 1);
	} finally {
		a.close();
	}
	void spawnSync;
});

test("a client with a wrong token gets nothing", { skip: process.platform === "win32" }, async () => {
	const a = await startAskpass();
	assert.ok(a);
	try {
		a.grant(() => "secret");
		const { createConnection } = await import("node:net");
		const sock = (await import("node:fs")).readFileSync(a.script, "utf8").match(/'([^']*\/s)'/)?.[1];
		assert.ok(sock);
		const reply = await new Promise<string>((resolve) => {
			const c = createConnection(sock);
			let buf = "";
			c.on("connect", () => c.write(`${JSON.stringify({ token: "wrong", prompt: "x" })}\n`));
			c.on("data", (d) => (buf += d));
			c.on("close", () => resolve(buf));
		});
		assert.equal(reply.trim(), "{}");
	} finally {
		a.close();
	}
});
