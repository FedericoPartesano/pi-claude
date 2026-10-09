import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryWorker } from "../src/memory-worker-client.ts";
import { saveStore, type MemoryRecord } from "../src/store.ts";
import { buildCorpus } from "./corpus.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 2, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [], ...extra });

async function worstGap(work: () => Promise<unknown>): Promise<number> {
	let last = performance.now();
	let worst = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		worst = Math.max(worst, now - last);
		last = now;
	}, 1);
	try {
		await work();
	} finally {
		clearInterval(timer);
	}
	return worst;
}

test("recall, core and vectors run in the worker: same answers, the UI thread does no memory work", async () => {
	const project = join(mkdtempSync(join(tmpdir(), "mw-")), "p");
	saveStore(project, { records: [rec("r1", "Le esportazioni Excel usano exceljs in streaming", { entities: ["exceljs"] }), rec("r2", "Rispondi sempre in italiano", { pinned: true })], vectors: new Map() });
	const memory = new MemoryWorker({ fake: true });
	try {
		assert.equal(await memory.start(), true);
		assert.equal(await memory.fillVectors(project), 2);
		assert.equal(await memory.hasVectors({ project }), true);
		const run = await memory.recall("come facciamo le esportazioni excel?", { project }, "2026-10-08");
		assert.deepEqual(run.ids, ["r1"]);
		assert.match(run.text, /exceljs/);
		assert.match((await memory.core({ project })) ?? "", /italiano/);
		assert.equal((await memory.embed(["ciao"], "query"))[0].length > 0, true);
	} finally {
		memory.close();
	}
});

test("warming a 30k-memory store happens off the UI thread", async () => {
	const project = join(mkdtempSync(join(tmpdir(), "mw-")), "p");
	saveStore(project, { records: buildCorpus(30_000).records, vectors: new Map() });
	const memory = new MemoryWorker({ fake: true });
	try {
		await memory.start();
		const gap = await worstGap(() => memory.warm({ project }));
		assert.ok(gap < 30, `UI thread blocked ${gap.toFixed(0)} ms`);
		const run = await memory.recall("perché l'esportazione delle fatture 100 è così lenta con file grandi?", { project }, "2026-10-08");
		assert.ok(run.ids.length > 0);
	} finally {
		memory.close();
	}
});

test("idle: the model is dropped but recall keeps working (keywords), and the model comes back by itself", async () => {
	const project = join(mkdtempSync(join(tmpdir(), "mw-")), "p");
	saveStore(project, { records: [rec("r1", "Le esportazioni Excel usano exceljs in streaming")], vectors: new Map() });
	const memory = new MemoryWorker({ fake: true, idleMs: 200 });
	try {
		await memory.start();
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.equal(memory.ready, false);
		const run = await memory.recall("esportazioni excel", { project }, "2026-10-08");
		assert.deepEqual(run.ids, ["r1"]);
		assert.equal(await memory.start(), true);
		assert.equal(memory.ready, true);
	} finally {
		memory.close();
	}
});

test("a process using the worker exits by itself once its requests are answered (pi -p hung)", async () => {
	const project = join(mkdtempSync(join(tmpdir(), "mw-")), "p");
	saveStore(project, { records: [rec("r1", "Le esportazioni Excel usano exceljs in streaming")], vectors: new Map() });
	const script = `import { MemoryWorker } from ${JSON.stringify(new URL("../src/memory-worker-client.ts", import.meta.url).href)};
const memory = new MemoryWorker({ fake: true });
const run = await memory.recall("esportazioni excel", { project: ${JSON.stringify(project)} }, "2026-10-08");
console.log(run.ids.join(","));`;
	const { spawnSync } = await import("node:child_process");
	const { writeFileSync } = await import("node:fs");
	// A file, not -e: the worker inherits the parent's Node flags, and --input-type is invalid for it.
	const file = join(mkdtempSync(join(tmpdir(), "mw-")), "run.mjs");
	writeFileSync(file, script);
	const started = Date.now();
	const result = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 20_000 });
	assert.equal(result.stdout.trim(), "r1", result.stderr);
	assert.ok(Date.now() - started < 10_000, "the process stayed alive");
});

test("if the worker dies, the requests waiting for it are answered in this thread instead of failing", async () => {
	const project = join(mkdtempSync(join(tmpdir(), "mw-")), "p");
	saveStore(project, { records: [rec("r1", "Le esportazioni Excel usano exceljs in streaming")], vectors: new Map() });
	const memory = new MemoryWorker({ fake: true });
	try {
		await memory.core({ project });
		const pending = memory.recall("esportazioni excel", { project }, "2026-10-08");
		const internals = memory as unknown as { pending: Map<number, unknown> };
		while (internals.pending.size === 0) await new Promise((resolve) => setImmediate(resolve));
		(memory as unknown as { worker: { emit: (event: string, error: Error) => void } }).worker.emit("error", new Error("boom"));
		assert.deepEqual((await pending).ids, ["r1"]);
		assert.deepEqual((await memory.recall("esportazioni excel", { project }, "2026-10-08")).ids, ["r1"], "later requests run locally");
	} finally {
		memory.close();
	}
});

test("a worker that exits without an error: waiting requests are answered here too", async () => {
	const project = join(mkdtempSync(join(tmpdir(), "mw-")), "p");
	saveStore(project, { records: [rec("r1", "Le esportazioni Excel usano exceljs in streaming")], vectors: new Map() });
	const memory = new MemoryWorker({ fake: true });
	try {
		await memory.core({ project });
		const pending = memory.recall("esportazioni excel", { project }, "2026-10-08");
		const internals = memory as unknown as { pending: Map<number, unknown>; worker: { emit: (event: string, code: number) => void } };
		while (internals.pending.size === 0) await new Promise((resolve) => setImmediate(resolve));
		internals.worker.emit("exit", 1);
		assert.deepEqual((await pending).ids, ["r1"]);
	} finally {
		memory.close();
	}
});
