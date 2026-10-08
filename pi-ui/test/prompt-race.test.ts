import { test } from "node:test";
import assert from "node:assert/strict";
import { patchPromptRace, runtimeAgentSession } from "../src/prompt-race.ts";
import { execFileSync } from "node:child_process";

type Fn = (this: unknown, ...args: any[]) => Promise<void>;
const BUSY = "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.";
test("a busy throw with a queueing mode becomes followUp/steer instead of an error", async () => {
	const calls: string[] = [];
	const proto = {
		async prompt() { throw new Error(BUSY); },
		async steer(t: string) { calls.push(`steer:${t}`); },
		async followUp(t: string) { calls.push(`followUp:${t}`); },
	};
	assert.equal(patchPromptRace(proto as never), true);
	await (proto.prompt as Fn).call(proto, "a", { streamingBehavior: "followUp" });
	await (proto.prompt as Fn).call(proto, "b", { streamingBehavior: "steer" });
	assert.deepEqual(calls, ["followUp:a", "steer:b"]);
});

test("without a queueing mode, or for other errors, the error still propagates", async () => {
	const proto = { async prompt(t: string) { throw new Error(t); }, async steer() {}, async followUp() {} };
	patchPromptRace(proto as never);
	await assert.rejects((proto.prompt as Fn).call(proto, BUSY, undefined), /already processing/);
	await assert.rejects((proto.prompt as Fn).call(proto, "No API key", { streamingBehavior: "followUp" }), /No API key/);
});

test("patching twice wraps once; success passes through", async () => {
	const proto = { async prompt() {}, async steer() {}, async followUp() {} };
	assert.equal(patchPromptRace(proto as never), true);
	assert.equal(patchPromptRace(proto as never), false);
	await (proto.prompt as Fn).call(proto, "ok", { streamingBehavior: "steer" });
});

test("runtimeAgentSession: the bundled CLI's class, not the imported copy; the fallback elsewhere", async (t) => {
	const fallback = class Imported {};
	assert.equal(await runtimeAgentSession(undefined, fallback), fallback);
	assert.equal(await runtimeAgentSession("/nonexistent/cli.js", fallback), fallback);
	let pi: string;
	try {
		pi = execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
	} catch {
		return t.skip("pi not installed");
	}
	const found = (await runtimeAgentSession(pi, fallback)) as { name?: string; prototype?: { prompt?: unknown } };
	assert.notEqual(found, fallback);
	assert.equal(typeof found.prototype?.prompt, "function");
});
