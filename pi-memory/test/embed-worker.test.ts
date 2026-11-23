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

test("an idle worker does not keep the process alive (pi -p hung 10 min after a compaction), a running embed does", { skip: !existsSync(join(homedir(), ".cache/pi-memory/models", MODELS.e5.name)) && "modello non scaricato" }, async () => {
	const { spawnSync } = await import("node:child_process");
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const file = join(mkdtempSync(join(tmpdir(), "embed-exit-")), "run.mjs");
	writeFileSync(file, `import { sharedEmbedder, MODELS } from ${JSON.stringify(new URL("../src/embed.ts", import.meta.url).href)};
const w = sharedEmbedder(MODELS.e5);
await w.start();
const chunks = Array.from({ length: 40 }, (_, i) => "testo numero " + i);
for (let i = 0; i < chunks.length; i += 16) await w.embed(chunks.slice(i, i + 16), "passage");
const [query] = await w.embed(["ciao"], "query");
console.log("dim", query.length);`);
	const started = Date.now();
	const run = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 45_000 });
	assert.match(run.stdout, /dim \d+/, "the embeds completed: loading and pending requests keep the loop alive");
	assert.equal(run.status, 0, `status ${run.status} signal ${run.signal}`);
	assert.ok(Date.now() - started < 40_000, `exited after ${Date.now() - started} ms`);
});
