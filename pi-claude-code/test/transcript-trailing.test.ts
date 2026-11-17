import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeProjectDirectory, writeClaudeSession } from "../src/claude-transcript.ts";

const assistant = (content: unknown[]) => ({ role: "assistant", content, api: "x", provider: "x", model: "m", usage: {}, stopReason: "toolUse", timestamp: 0 }) as never;

test("history ending with tool results: held back, never written as a final user turn", () => {
	process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "cc-"));
	const history = [
		{ role: "user", content: "leggi", timestamp: 0 } as never,
		assistant([{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } }]),
		{ role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 0 } as never,
	];
	const written = writeClaudeSession(history, "/tmp/x", "haiku");
	assert.equal(written.trailingUser.length, 1);
	assert.equal(written.trailingUser[0].type, "tool_result");
	const lines = readFileSync(join(claudeProjectDirectory("/tmp/x"), `${written.sessionId}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.deepEqual(lines.map((l) => l.type), ["user", "assistant"]);
	written.dispose();
});

test("history ending with an assistant message: nothing held", () => {
	process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "cc-"));
	const history = [{ role: "user", content: "ciao", timestamp: 0 } as never, assistant([{ type: "text", text: "salve" }])];
	const written = writeClaudeSession(history, "/tmp/y", "haiku");
	assert.deepEqual(written.trailingUser, []);
	assert.ok(written.sessionId);
	written.dispose();
});
