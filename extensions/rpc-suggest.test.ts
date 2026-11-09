import assert from "node:assert/strict";
import { test } from "node:test";
import rpcSuggest, { MARK, PROMPT } from "./rpc-suggest.ts";

function run(mode: string) {
	let handler: ((event: unknown, ctx: unknown) => void) | undefined;
	rpcSuggest({ on: (_name: string, fn: typeof handler) => (handler = fn) } as never);
	const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
	handler!(event, { mode });
	return event.systemPromptOptions.sections;
}

test("in RPC mode the suggestions instruction is added", () => {
	assert.equal(run("rpc").suggerimenti, PROMPT);
	assert.ok(PROMPT.includes(MARK));
});

test("in the TUI pi-ui does it, not this extension", () => {
	assert.deepEqual(run("tui"), {});
});
