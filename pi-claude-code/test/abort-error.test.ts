import assert from "node:assert/strict";
import { test } from "node:test";
import { isAbortError } from "../src/provider.ts";

test("recognises an aborted request so it is not reported as a model error", () => {
	// The user typed while the model was streaming, or an in-flight tool was killed.
	assert.equal(isAbortError(new Error("This operation was aborted")), true);
	assert.equal(isAbortError(new Error("Request was aborted")), true);
	assert.equal(isAbortError(new Error("Command aborted")), true);
	const named = new Error("boom");
	named.name = "AbortError";
	assert.equal(isAbortError(named), true);
});

test("leaves a real model error classified as an error", () => {
	assert.equal(isAbortError(new Error("Claude Code error: overloaded")), false);
	assert.equal(isAbortError("aborted"), false);
	assert.equal(isAbortError(undefined), false);
});
