import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeSession } from "../src/claude-session.ts";

test("scrivere a Claude Code dopo che è uscito (EPIPE) non fa cadere il processo: la sessione risulta finita", async () => {
	const dir = mkdtempSync(join(tmpdir(), "epipe-"));
	const fake = join(dir, "claude");
	writeFileSync(fake, "#!/bin/sh\nexit 0\n");
	chmodSync(fake, 0o755);
	const uncaught: Error[] = [];
	const onUncaught = (error: Error) => uncaught.push(error);
	process.on("uncaughtException", onUncaught);
	try {
		const session = new ClaudeSession("sig", { claudeBinary: fake, model: "m", systemPrompt: "", tools: [], cwd: dir, mcpServer: { url: "http://127.0.0.1:1", close() {} } as never } as never);
		await new Promise((resolve) => setTimeout(resolve, 300));
		for (let i = 0; i < 20; i++) session.sendUserMessage([{ type: "text", text: "x".repeat(70000) }]);
		await new Promise((resolve) => setTimeout(resolve, 500));
		assert.deepEqual(uncaught.map((e) => e.message), []);
		assert.equal(session.isAlive, false);
	} finally {
		process.off("uncaughtException", onUncaught);
	}
});
