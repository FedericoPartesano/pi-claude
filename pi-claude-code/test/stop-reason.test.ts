import assert from "node:assert/strict";
import { test } from "node:test";
import { stopReasonProblem } from "../src/provider.ts";

test("a normal stop reason is not a problem", () => {
	for (const reason of ["end_turn", "stop_sequence", "pause_turn", "tool_use", "max_tokens"]) {
		assert.equal(stopReasonProblem(reason), undefined);
	}
});

test("a refusal or a full context window says so instead of an unknown error", () => {
	// Without a message Pi showed these as an empty "unknown error".
	assert.match(stopReasonProblem("refusal") ?? "", /refusal/);
	assert.match(stopReasonProblem("model_context_window_exceeded") ?? "", /context window/);
});

test("an unknown stop reason is reported by name", () => {
	assert.match(stopReasonProblem("something_new") ?? "", /something_new/);
});
