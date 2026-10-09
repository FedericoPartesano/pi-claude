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

test("Recaller: the merged index (project + global) and its vectors are built once, until a store changes", async () => {
	const root = mkdtempSync(join(tmpdir(), "rec-"));
	const project = join(root, "p");
	const global = join(root, "g");
	const record = (id: string, text: string) => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active" as const, entities: [] });
	saveStore(project, { records: [record("r1", "Le esportazioni Excel usano exceljs")], vectors: new Map(), model: "fake" });
	saveStore(global, { records: [record("r1", "Rispondi sempre in italiano")], vectors: new Map(), model: "fake" });
	const recaller = new Recaller();
	const first = recaller.indexFor({ project, global });
	assert.equal(recaller.indexFor({ project, global }), first, "same index object on the next request");
	await new Promise((resolve) => setTimeout(resolve, 20));
	saveStore(project, { records: [record("r1", "Le esportazioni Excel usano exceljs"), record("r2", "I report usano pdfkit")], vectors: new Map(), model: "fake" });
	const second = recaller.indexFor({ project, global });
	assert.notEqual(second, first, "rebuilt after a change");
	assert.equal(second.index.records.length, 3);
});

test("forgotten memories (forgotten.jsonl) are found by a deep search, never by the cues of a request", async () => {
	const project = join(tmp(), "p");
	saveStore(project, { records: [rec("r1", "Il logger è in src/lib/logger.ts")], vectors: new Map() });
	const { writeFileSync } = await import("node:fs");
	writeFileSync(join(project, "forgotten.jsonl"), `${JSON.stringify({ ...rec("r9", "La procedura di deploy passa da GitHub Actions sul branch release"), state: "dormant", forgottenAt: "2026-09-01" })}\n`);
	const recaller = new Recaller();
	const cues = await recaller.run("come facciamo il deploy su release?", { project }, "2026-10-09");
	assert.deepEqual(cues.ids, []);
	const deep = await recaller.run("come facciamo il deploy su release?", { project }, "2026-10-09", undefined, { includeSuperseded: true, threshold: 0.25 });
	assert.deepEqual(deep.hits.map((hit) => hit.record.id), ["r9"]);
	assert.equal(deep.hits[0].record.forgottenAt, "2026-09-01");
});

test("open: a memory by id with its state and its neighbours in the graph (links first)", async () => {
	const project = join(tmp(), "p");
	saveStore(project, {
		records: [
			rec("r1", "L'esportazione usa ReportBuilder", { links: ["r2"], entities: ["builder.ts"] }),
			rec("r2", "La coda reports ha concorrenza 1 per la RAM del pod", { confirmations: 3, last: "2026-09-01" }),
			rec("r3", "builder.ts genera anche i PDF", { entities: ["builder.ts"] }),
			rec("r4", "Le date si salvano in UTC"),
		],
		vectors: new Map(),
	});
	const recaller = new Recaller();
	const text = recaller.open({ project }, "r1");
	assert.match(text, /^#r1 \[fatto\] L'esportazione usa ReportBuilder/);
	assert.match(text, /Collegati:\n- #r2 .*concorrenza 1/);
	assert.match(text, /#r3 .*PDF/);
	assert.doesNotMatch(text, /#r4/);
	assert.match(recaller.open({ project }, "#r2"), /conferme 3/);
	assert.match(recaller.open({ project }, "r99"), /non trovato/);
});

test("core: the project overview (gist.md) plus pinned memories not already in it, within the budget", async () => {
	const project = join(tmp(), "p");
	saveStore(project, { records: [rec("r1", "Risposte sempre in italiano", { pinned: true }), rec("r2", "Le date in UTC", { pinned: true })], vectors: new Map() });
	const { writeFileSync } = await import("node:fs");
	writeFileSync(join(project, "gist.md"), "Progetto: gestionale ordini in NestJS. Le date in UTC.\n");
	const core = new Recaller().core({ project }) ?? "";
	assert.match(core, /Quadro del progetto/);
	assert.match(core, /gestionale ordini/);
	assert.match(core, /italiano/);
	assert.equal(core.match(/date in UTC/gi)?.length, 1, "a pinned memory already in the overview is not repeated");
	assert.ok(core.length <= 1700);
});
