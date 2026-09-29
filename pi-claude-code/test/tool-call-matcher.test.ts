// node --test test/tool-call-matcher.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolCallMatcher } from "../src/tool-call-matcher.ts";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const signal = () => new AbortController().signal;

test("tool_use first, then the MCP call: matched and released with Pi's result", async () => {
	const matcher = new ToolCallMatcher();
	matcher.expect("t1", "bash", { command: "echo ok" });
	const call = matcher.handleCall("bash", { command: "echo ok" }, signal());
	assert.equal(matcher.resolve("t1", ok("ok")), true);
	assert.deepEqual(await call, ok("ok"));
	assert.equal(matcher.has("t1"), false);
});

test("MCP call BEFORE its tool_use (the sdk-transport race): it waits, it is not refused", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 1000 });
	const call = matcher.handleCall("bash", { command: "echo ok" }, signal());
	matcher.expect("t1", "bash", { command: "echo ok" });
	matcher.resolve("t1", ok("ok"));
	assert.deepEqual(await call, ok("ok"));
});

test("parallel calls arriving early are paired by name and arguments, whatever the order", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 1000 });
	const readCall = matcher.handleCall("read", { path: "a" }, signal());
	const bashCall = matcher.handleCall("bash", { command: "ls" }, signal());
	matcher.expect("t2", "bash", { command: "ls" });
	matcher.expect("t1", "read", { path: "a" });
	matcher.resolve("t1", ok("A"));
	matcher.resolve("t2", ok("LS"));
	assert.deepEqual(await readCall, ok("A"));
	assert.deepEqual(await bashCall, ok("LS"));
});

test("Pi's result before the MCP call: stored and handed over when the call comes", async () => {
	const matcher = new ToolCallMatcher();
	matcher.expect("t1", "read", { path: "a" });
	matcher.resolve("t1", ok("A"));
	assert.deepEqual(await matcher.handleCall("read", { path: "a" }, signal()), ok("A"));
});

test("a call with no tool_use at all is still refused, after the wait", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 20 });
	const result = await matcher.handleCall("bash", { command: "rm -rf /" }, signal());
	assert.equal(result.isError, true);
	assert.match((result.content[0] as { text: string }).text, /was not expected by Pi/);
	// A late tool_use no longer matches the refused call.
	matcher.expect("t1", "bash", { command: "rm -rf /" });
	assert.equal(matcher.has("t1"), true);
});

test("different arguments do not match: the waiting call is refused", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 20 });
	const call = matcher.handleCall("bash", { command: "ls" }, signal());
	matcher.expect("t1", "bash", { command: "ls -la" });
	assert.equal((await call).isError, true);
});

test("willBeCalled: false never pairs with a waiting call", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 20 });
	const call = matcher.handleCall("bash", { command: "ls" }, signal());
	matcher.expect("t1", "bash", { command: "ls" }, { willBeCalled: false });
	assert.equal((await call).isError, true);
	assert.equal(matcher.resolve("t1", ok("x")), true);
	assert.equal(matcher.has("t1"), false);
});

test("abort while waiting rejects the call", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 1000 });
	const controller = new AbortController();
	const call = matcher.handleCall("bash", { command: "ls" }, controller.signal);
	controller.abort();
	await assert.rejects(call, /cancelled/);
});

test("failAll rejects both waiting and claimed calls", async () => {
	const matcher = new ToolCallMatcher({ unmatchedWaitMs: 1000 });
	const waiting = matcher.handleCall("bash", { command: "a" }, signal());
	matcher.expect("t1", "read", { path: "b" });
	const claimed = matcher.handleCall("read", { path: "b" }, signal());
	matcher.failAll(new Error("claude exited"));
	await assert.rejects(waiting, /claude exited/);
	await assert.rejects(claimed, /claude exited/);
});
