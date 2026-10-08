import { test } from "node:test";
import assert from "node:assert/strict";
import { applyClaudeResult } from "../../harness.mjs";

test("the result record's usage (turn totals) replaces the partial per-message counts", () => {
	const turn = { answer: "", errors: [], denials: 0, inputTokens: 20, outputTokens: 2 };
	applyClaudeResult(turn, { type: "result", result: "ok", usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 14261, output_tokens: 347 }, permission_denials: [] });
	assert.equal(turn.outputTokens, 347);
	assert.equal(turn.inputTokens, 14276);
	assert.equal(turn.answer, "ok");
});

test("without usage in the result the streamed counts stay", () => {
	const turn = { answer: "", errors: [], denials: 0, inputTokens: 20, outputTokens: 2 };
	applyClaudeResult(turn, { type: "result", result: "x", is_error: true, subtype: "error_max_turns" });
	assert.deepEqual([turn.inputTokens, turn.outputTokens, turn.errors.length], [20, 2, 1]);
});
