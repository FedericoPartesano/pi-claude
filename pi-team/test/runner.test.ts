import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRole } from "../src/roles.ts";
import { runAgent } from "../src/runner.ts";

const FAKE_PI = new URL("./fixtures/fake-pi.mjs", import.meta.url).pathname;

function withFakePi<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
	const saved = { ...process.env };
	Object.assign(process.env, { PI_TEAM_PI_BINARY: FAKE_PI, ...env });
	return body().finally(() => (process.env = saved));
}

test("children run without skills (they only add prompt tokens)", async () => {
	const argsFile = join(tmpdir(), `fake-pi-args-${process.pid}.json`);
	const run = await withFakePi({ FAKE_PI_ARGS: argsFile }, () => runAgent({ role: parseRole("x", "scout"), prompt: "p", cwd: tmpdir() }));
	assert.equal(run.ok, true);
	assert.ok(JSON.parse(readFileSync(argsFile, "utf8")).includes("--no-skills"));
});

test("an agent over its role's input token cap is stopped", async () => {
	const role = parseRole("---\nmaxInputTokens: 2500\n---\nx", "scout");
	const run = await withFakePi({ FAKE_PI_TURNS: "10", FAKE_PI_INPUT: "1000" }, () => runAgent({ role, prompt: "p", cwd: tmpdir() }));
	assert.equal(run.ok, false);
	assert.match(run.error ?? "", /token/);
	assert.ok(run.requests < 10, `stopped early, got ${run.requests} requests`);
});

test("an agent under its cap finishes normally", async () => {
	const role = parseRole("---\nmaxInputTokens: 100000\n---\nx", "scout");
	const run = await withFakePi({ FAKE_PI_TURNS: "3" }, () => runAgent({ role, prompt: "p", cwd: tmpdir() }));
	assert.equal(run.ok, true);
	assert.equal(run.requests, 3);
});
