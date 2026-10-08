import { test } from "node:test";
import assert from "node:assert/strict";
import { piArgs } from "../../harness.mjs";

test("Pi runs ephemeral by default; persistSession keeps the session for /dream", () => {
	assert.deepEqual(piArgs("opus", {}), ["--mode", "rpc", "--no-session", "--provider", "claude-code", "--model", "opus"]);
	assert.deepEqual(piArgs("opus", { persistSession: true, extraArgs: ["--thinking", "high"] }), ["--mode", "rpc", "--provider", "claude-code", "--model", "opus", "--thinking", "high"]);
});
