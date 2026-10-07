import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeEmbedder } from "../src/embed.ts";
import { saveStore, loadStore, type MemoryRecord } from "../src/store.ts";
import { Recaller, fillVectors, appendRecallLog } from "../src/engine.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [], ...extra });
const tmp = () => mkdtempSync(join(tmpdir(), "pi-engine-"));

test("fillVectors embeds only what is missing and records the model", async () => {
	const dir = tmp();
	saveStore(dir, { records: [rec("r1", "Prezzi in centesimi interi."), rec("r2", "Database PostgreSQL.")], vectors: new Map() });
	const embedder = createFakeEmbedder();
	assert.equal(await fillVectors(dir, embedder), 2);
	assert.equal(await fillVectors(dir, embedder), 0);
	const back = loadStore(dir);
	assert.equal(back.vectors.size, 2);
	assert.equal(back.model, "fake");
});

test("Recaller: relevant -> injected text; unrelated -> empty; global + project merged; core only pinned", async () => {
	const project = tmp();
	const global = tmp();
	saveStore(project, { records: [rec("r1", "Prezzi sempre in centesimi interi, mai float.", { entities: ["prezzi"] }), rec("r2", "Il database è PostgreSQL 15.")], vectors: new Map() });
	saveStore(global, { records: [rec("r1", "Rispondi sempre in italiano.", { pinned: true }), rec("r2", "Niente commit senza richiesta.")], vectors: new Map() });
	const embedder = createFakeEmbedder();
	await fillVectors(project, embedder);
	const recaller = new Recaller();
	const dirs = { project, global };
	const hit = await recaller.run("come salvo i prezzi in float?", dirs, "2026-10-06", embedder);
	assert.match(hit.text, /centesimi interi/);
	assert.equal(hit.embedderReady, true);
	assert.ok(hit.text.length <= 1080);
	const none = await recaller.run("qual è la capitale della Francia?", dirs, "2026-10-06", embedder);
	assert.equal(none.text, "");
	assert.deepEqual(none.ids, []);
	assert.match(recaller.core(dirs)!, /italiano/);
	assert.ok(!recaller.core(dirs)!.includes("commit"));
	// not ready -> lexical fallback still works, never throws
	const lexical = await recaller.run("che database usiamo?", dirs, "2026-10-06", { embed: async () => { throw new Error("x"); }, ready: false } as never);
	assert.equal(lexical.embedderReady, false);
	assert.match(lexical.text, /PostgreSQL/);
});

test("recall log: one JSON line per recall, also when nothing is injected", () => {
	const dir = tmp();
	appendRecallLog(dir, { mode: "deep", query: "x".repeat(300), injected: [], chars: 0, estTokens: 0, embedderReady: false, ms: 1.2 });
	const line = JSON.parse(readFileSync(join(dir, "recall-log.jsonl"), "utf8").trim());
	assert.equal(line.query.length, 120);
	assert.deepEqual(line.injected, []);
	assert.ok(line.timestamp);
	assert.ok(existsSync(join(dir, "recall-log.jsonl")));
});
