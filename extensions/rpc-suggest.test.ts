import assert from "node:assert/strict";
import { test } from "node:test";
import rpcSuggest, { MARK, PROMPT } from "./rpc-suggest.ts";

function run(mode: string, systemPrompt = "base") {
	let handler: ((event: unknown, ctx: unknown) => { systemPrompt?: string } | void) | undefined;
	rpcSuggest({ on: (_name: string, fn: typeof handler) => (handler = fn) } as never);
	return handler!({ systemPrompt }, { mode });
}

// Appended to the chained prompt: a section in systemPromptOptions was lost when a later handler (caveman) returned
// a whole systemPrompt, and the model never saw the instruction.
test("in RPC mode the suggestions instruction is appended to the chained prompt", () => {
	assert.equal(run("rpc")?.systemPrompt, `base\n\n${PROMPT}`);
	assert.ok(PROMPT.includes(MARK));
});

test("added once: a prompt that already has it stays as it is", () => {
	assert.equal(run("rpc", `base\n\n${PROMPT}`), undefined);
});

test("in the TUI pi-ui does it, not this extension", () => {
	assert.equal(run("tui"), undefined);
});
