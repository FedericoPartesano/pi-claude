import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeProjectDirectory, writeClaudeSession } from "../src/claude-transcript.ts";

const assistant = (content: unknown[]) => ({ role: "assistant", content, api: "x", provider: "x", model: "m", usage: {}, stopReason: "toolUse", timestamp: 0 }) as never;

// Measured with claude 2.1.330: a tool_use left without its result at the end of a resumed session gets a synthetic
// "[Tool call interrupted …]" result, and the real one sent next is lost (the model re-runs the call). Written, it survives.
test("history ending with tool results: written as the final user turn, nothing held", () => {
	process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "cc-"));
	const history = [
		{ role: "user", content: "leggi", timestamp: 0 } as never,
		assistant([{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } }]),
		{ role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 0 } as never,
	];
	const written = writeClaudeSession(history, "/tmp/x", "haiku");
	assert.deepEqual(written.trailingUser, []);
	const lines = readFileSync(join(claudeProjectDirectory("/tmp/x"), `${written.sessionId}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.deepEqual(lines.map((l) => l.type), ["user", "assistant", "user"]);
	assert.equal(lines[2].message.content[0].type, "tool_result");
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

// Live, Claude Code answers a tool_use whose JSON does not parse with an InputValidationError ("could not be parsed
// as JSON … Retry with valid JSON", measured on claude 2.1.330 with a fake API). Pi's own result for it is a schema
// error ("content: missing") that sent the model fixing the shape instead of the brackets: on resume, write what
// Claude Code would have said.
test("tool call with unparseable JSON: resumed as Claude Code's InputValidationError, not Pi's schema error", () => {
	process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "cc-"));
	const raw = `{"content": [{"startId": "m1", "endId": "m2", "summary": "${"x".repeat(400)} end"]}`;
	const history = [
		{ role: "user", content: "comprimi", timestamp: 0 } as never,
		assistant([{ type: "toolCall", id: "t1", name: "compress", arguments: { __unparsedToolInput: raw } }]),
		{ role: "toolResult", toolCallId: "t1", toolName: "compress", content: [{ type: "text", text: 'Validation failed for tool "compress":\n  - content: missing' }], isError: true, timestamp: 0 } as never,
		assistant([{ type: "text", text: "riprovo" }]),
	];
	const written = writeClaudeSession(history, "/tmp/z", "haiku");
	const lines = readFileSync(join(claudeProjectDirectory("/tmp/z"), `${written.sessionId}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.deepEqual(lines[1].message.content[0].input, {});
	const result = lines[2].message.content[0];
	assert.equal(result.is_error, true);
	const text = result.content[0].text;
	assert.match(text, /InputValidationError: compress was called with input that could not be parsed as JSON/);
	assert.match(text, /end"\]\}/, "shows the tail where the brackets went wrong");
	assert.ok(!text.includes("content: missing"));
	assert.ok(text.length < 600, "bounded");
	written.dispose();
});
