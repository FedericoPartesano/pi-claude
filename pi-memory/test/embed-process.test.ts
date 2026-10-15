import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
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

test("when the child process cannot run, the model loads in this process and gives the same vectors", { skip: !cached && "modello non scaricato" }, async () => {
	const embedder = new ProcessEmbedder(MODELS.minilm, { childFile: join(tmpdir(), "no-such-embed-child.ts") });
	assert.equal(await embedder.start(), true, "fell back to the in-process model");
	assert.equal(embedder.inProcess, true);
	assert.equal(embedder.ready, true);
	const [vector] = await embedder.embed(["i messaggi di errore vanno in italiano"], "query");
	const local = new BackgroundEmbedder(MODELS.minilm);
	await local.start();
	const [expected] = await local.embed(["i messaggi di errore vanno in italiano"], "query");
	for (let index = 0; index < vector.length; index++) assert.ok(Math.abs(vector[index] - expected[index]) < 1e-5);
	embedder.close();
	assert.equal(embedder.ready, false);
});

test("a model that does not load in the child is a plain failure, not a fallback", { skip: !cached && "modello non scaricato" }, async () => {
	const embedder = new ProcessEmbedder({ ...MODELS.minilm, name: "Xenova/does-not-exist-xyz" });
	const previous = process.env.HF_HUB_OFFLINE;
	assert.equal(await embedder.start(), false);
	assert.equal(embedder.inProcess, false);
	embedder.close();
	if (previous !== undefined) process.env.HF_HUB_OFFLINE = previous;
});
