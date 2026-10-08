import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BackgroundEmbedder, MODELS, WorkerEmbedder } from "../src/embed.ts";

const cached = existsSync(join(homedir(), ".cache/pi-memory/models", MODELS.minilm.name));

test("the embedder in a worker thread gives the same vectors and never blocks the main thread while loading", { skip: !cached && "modello non scaricato" }, async () => {
	const worker = new WorkerEmbedder(MODELS.minilm);
	let last = performance.now();
	let worst = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		worst = Math.max(worst, now - last);
		last = now;
	}, 5);
	assert.equal(await worker.start(), true);
	const [fromWorker] = await worker.embed(["i messaggi di errore vanno in italiano"], "query");
	clearInterval(timer);
	assert.ok(worst < 400, `main thread blocked ${Math.round(worst)} ms while loading`);
	const local = new BackgroundEmbedder(MODELS.minilm);
	await local.start();
	const [fromThread] = await local.embed(["i messaggi di errore vanno in italiano"], "query");
	assert.equal(fromWorker.length, fromThread.length);
	for (let index = 0; index < fromWorker.length; index++) assert.ok(Math.abs(fromWorker[index] - fromThread[index]) < 1e-5);
	worker.close();
});

test("an idle embedder unloads its model (memory back to the system) and reloads by itself on the next use", { skip: !cached && "modello non scaricato" }, async () => {
	const worker = new WorkerEmbedder(MODELS.minilm, { idleMs: 300 });
	assert.equal(await worker.start(), true);
	await worker.embed(["prima"], "query");
	await new Promise((resolve) => setTimeout(resolve, 600));
	assert.equal(worker.ready, false, "unloaded after being idle");
	await assert.rejects(worker.embed(["dopo"], "query"), /not ready/, "callers fall back to keyword recall meanwhile");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(await worker.start(), true, "reloading started by itself");
	assert.equal((await worker.embed(["dopo"], "query")).length, 1);
	worker.close();
});
