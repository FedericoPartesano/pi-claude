import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BackgroundEmbedder, MODELS } from "../src/embed.ts";
import { ProcessEmbedder } from "../src/embed-process.ts";

const cached = existsSync(join(homedir(), ".cache/pi-memory/models", MODELS.minilm.name));

test("the embedder in a child process gives the same vectors and closing it kills the process (memory back to the system)", { skip: !cached && "modello non scaricato" }, async () => {
	const embedder = new ProcessEmbedder(MODELS.minilm);
	assert.equal(await embedder.start(), true);
	const pid = (embedder as unknown as { child: { pid: number } }).child.pid;
	const [fromProcess] = await embedder.embed(["i messaggi di errore vanno in italiano"], "query");
	const local = new BackgroundEmbedder(MODELS.minilm);
	await local.start();
	const [fromThread] = await local.embed(["i messaggi di errore vanno in italiano"], "query");
	assert.equal(fromProcess.length, fromThread.length);
	for (let index = 0; index < fromProcess.length; index++) assert.ok(Math.abs(fromProcess[index] - fromThread[index]) < 1e-5);
	embedder.close();
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.throws(() => process.kill(pid, 0), /ESRCH/, "child process is gone");
	assert.equal(embedder.ready, false);
	await assert.rejects(embedder.embed(["dopo"], "query"), /not ready/);
	assert.equal(await embedder.start(), true, "starts again by itself after a close");
	embedder.close();
});
