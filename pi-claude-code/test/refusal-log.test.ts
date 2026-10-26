import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderRequest, writeRefusalLog } from "../src/refusal-log.ts";

const messages = [
	{ role: "user", content: "<conversation>\n[User]: ciao\n</conversation>" },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "ok" },
			{ type: "toolCall", name: "bash", arguments: { command: "ls" } },
		],
	},
	{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "a.txt" }, { type: "image", data: "AAAA" }] },
];

test("renders text, tool calls and images without the base64", () => {
	const text = renderRequest("SYS", messages as never);
	assert.match(text, /\[user\]\n<conversation>/);
	assert.match(text, /bash\(\{"command":"ls"\}\)/);
	assert.match(text, /\[image\]/);
	assert.doesNotMatch(text, /AAAA/);
});

test("writes one file per refusal with the model and the request", () => {
	const dir = mkdtempSync(join(tmpdir(), "refusal-"));
	const file = writeRefusalLog(dir, "claude-opus", "SYS", messages as never, new Date("2026-10-26T07:43:50Z"));
	assert.ok(file);
	assert.equal(readdirSync(dir).length, 1);
	const body = readFileSync(file, "utf8");
	assert.match(body, /model: claude-opus/);
	assert.match(body, /messages: 3/);
	assert.match(body, /\[system\]\nSYS/);
});

test("a log failure never throws", () => {
	// A directory path under a regular file always fails (unlike /proc, which hangs on WSL).
	const dir = mkdtempSync(join(tmpdir(), "refusal-"));
	const file = join(dir, "plain");
	writeFileSync(file, "x");
	assert.equal(writeRefusalLog(join(file, "sub"), "m", "S", messages as never), undefined);
});
