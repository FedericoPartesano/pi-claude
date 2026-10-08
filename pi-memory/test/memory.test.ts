import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractEntities } from "../src/entities.ts";
import { strength } from "../src/strength.ts";
import { createFakeEmbedder } from "../src/embed.ts";
import { loadStore, saveStore, migrateLegacy, missingVectors, type MemoryRecord } from "../src/store.ts";
import { RecallIndex, recall, renderRecall, coreSection, RECALL_BUDGET_CHARS } from "../src/recall.ts";
import { recordsToEntries, entriesToRecords } from "../src/reconcile.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });
const tmp = () => mkdtempSync(join(tmpdir(), "pi-memory-"));

test("extractEntities: paths, identifiers, file names (deterministic)", () => {
	const found = extractEntities("Usa totalValue in src/lib/price.ts e il campo unit_price; leggi @docs/api.md. Niente parole comuni.");
	for (const wanted of ["totalvalue", "src/lib/price.ts", "unit_price", "docs/api.md", "price.ts"]) assert.ok(found.includes(wanted), wanted);
	assert.ok(!found.includes("niente"));
});

test("strength grows with confirmations and fades with time, bounded in (0,1]", () => {
	const fresh = strength(rec("a", "x", { confirmations: 5, last: "2026-10-06" }), "2026-10-06");
	const weak = strength(rec("b", "x", { confirmations: 1, last: "2025-01-01" }), "2026-10-06");
	assert.ok(fresh > weak && fresh <= 1 && weak > 0);
});

test("fake embedder is deterministic and similar texts are closer", async () => {
	const e = createFakeEmbedder();
	const [a, b, c] = await e.embed(["prezzi in centesimi interi", "prezzi centesimi", "database postgres produzione"]);
	const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
	assert.ok(dot(a, b) > dot(a, c));
	assert.deepEqual((await e.embed(["prezzi in centesimi interi"]))[0], a);
});

test("store: jsonl + vectors round-trip, no cap", () => {
	const dir = tmp();
	const records = Array.from({ length: 300 }, (_, i) => rec(`r${i}`, `ricordo numero ${i}`));
	const vectors = new Map([["r1", new Float32Array([0.5, -0.25])]]);
	saveStore(dir, { records, vectors, model: "m" });
	const back = loadStore(dir);
	assert.equal(back.records.length, 300);
	assert.deepEqual([...back.vectors.get("r1")!], [0.5, -0.25]);
	assert.deepEqual(missingVectors(back).slice(0, 2).map((r) => r.id), ["r0", "r2"]);
	assert.equal(loadStore(join(dir, "nope")).records.length, 0);
});

test("migration from memory.md / memory-archive.md, once", () => {
	const dir = tmp();
	const legacy = join(dir, "memory.md");
	writeFileSync(legacy, "# Memoria di Pi\n- [preferenza] Niente commit senza richiesta. 📌 (conferme: 5 · ultima: 2026-10-05)\n- [fatto] Il test di totalValue è rotto. (conferme: 2 · ultima: 2026-06-01)\n");
	writeFileSync(join(dir, "memory-archive.md"), '# A\n- [preferenza] Script in italiano. (conferme: 2 · ultima: 2026-03-01 · archiviato: 2026-07-01 · motivo: superato da "Script in inglese.")\n- [fatto] Extra. (conferme: 1 · ultima: 2026-03-01 · archiviato: 2026-07-01 · motivo: oltre il tetto della memoria)\n');
	const store = join(dir, "memory");
	assert.ok(migrateLegacy(store, legacy, join(dir, "memory-archive.md"), "2026-10-06"));
	const { records } = loadStore(store);
	assert.equal(records.length, 4);
	assert.equal(records.find((r) => r.text.startsWith("Niente"))!.pinned, true);
	assert.equal(records.find((r) => r.text.startsWith("Script"))!.status, "superseded");
	assert.equal(records.find((r) => r.text === "Extra.")!.status, "active"); // the cap no longer exists
	assert.ok(records.find((r) => r.text.includes("totalValue"))!.entities.includes("totalvalue"));
	assert.equal(migrateLegacy(store, legacy, join(dir, "memory-archive.md"), "2026-10-06"), false);
});

const CORPUS = [
	rec("r1", "Prezzi sempre in centesimi interi, mai float.", { type: "correzione", entities: ["prezzi"] }),
	rec("r2", "Il database di produzione è PostgreSQL 15.", { entities: ["postgresql"] }),
	rec("r3", "Messaggi d'errore sempre in italiano.", { type: "preferenza" }),
	rec("r4", "Il calcolo di totalValue sta in src/lib/price.ts.", { entities: ["totalvalue", "src/lib/price.ts", "price.ts"] }),
	rec("r5", "Vecchia regola: prezzi in float.", { status: "superseded", supersededBy: "r1" }),
	rec("r6", "I test dei prezzi usano src/lib/price.ts come fixture.", { entities: ["src/lib/price.ts", "price.ts"] }),
];

test("recall: relevant query returns the right memory, never superseded; unrelated returns nothing", async () => {
	const index = new RecallIndex(CORPUS);
	const embedder = createFakeEmbedder();
	const vectors = new Map(CORPUS.map((r, i) => [r.id, null as unknown as Float32Array]));
	const vs = await embedder.embed(CORPUS.map((r) => r.text));
	CORPUS.forEach((r, i) => vectors.set(r.id, vs[i]));
	const hit = recall(index, "come salvo i prezzi dei prodotti in float?", { today: "2026-10-06", vectors, queryVector: (await embedder.embed(["come salvo i prezzi dei prodotti in float?"]))[0] });
	assert.equal(hit.hits[0].record.id, "r1");
	assert.ok(!hit.hits.some((h) => h.record.id === "r5"));
	const none = recall(index, "qual è la capitale della Francia?", { today: "2026-10-06", vectors, queryVector: (await embedder.embed(["qual è la capitale della Francia?"]))[0] });
	assert.equal(none.hits.length, 0);
});

test("recall without embedder: BM25 + entities; @file mention + one-step association", () => {
	const index = new RecallIndex(CORPUS);
	const hit = recall(index, "correggi @src/lib/price.ts", { today: "2026-10-06" });
	assert.deepEqual(hit.hits.slice(0, 2).map((h) => h.record.id).sort(), ["r4", "r6"]);
	assert.equal(recall(index, "ciao", { today: "2026-10-06" }).hits.length, 0);
	// includeSuperseded is for /ricorda only
	assert.ok(recall(index, "prezzi float", { today: "2026-10-06", includeSuperseded: true, threshold: 0.15 }).hits.some((h) => h.record.id === "r5"));
});

test("render: at most 5 memories within the char budget, short header", () => {
	const many = Array.from({ length: 12 }, (_, i) => rec(`r${i}`, `Ricordo lungo ${"parola ".repeat(30)} ${i}`));
	const text = renderRecall(many.map((record) => ({ record, score: 1 })));
	assert.ok(text.length <= RECALL_BUDGET_CHARS);
	assert.match(text, /^Ricordi pertinenti \(da sessioni precedenti/);
	// Context, not a request: the model must answer the user's message, not the memories (it once replied to them).
	assert.match(text.split("\n")[0], /non sono una richiesta/);
	assert.ok(text.split("\n").length - 1 <= 5);
	assert.equal(renderRecall([]), "");
});

test("core section: only pinned, small", () => {
	const pinned = Array.from({ length: 30 }, (_, i) => rec(`p${i}`, `Regola fissa numero ${i} da rispettare sempre.`, { pinned: true }));
	const section = coreSection([...pinned, rec("x", "non fissato")])!;
	assert.ok(section.length < 500);
	assert.ok(!section.includes("non fissato"));
	assert.equal(coreSection([rec("x", "a")]), undefined);
});

test("reconcile: entries <-> records keep ids, supersede on update, episodes stay active", () => {
	const prev = [rec("r1", "Intent in intent/.", { confirmations: 2 }), rec("r2", "Fisso.", { pinned: true })];
	const { memory, archive } = recordsToEntries(prev);
	assert.equal(memory[0].id, "r1");
	const next = entriesToRecords(
		[{ ...memory[1] }, { type: "decisione", text: "Intent in docs/intents/.", pinned: false, confirmations: 3, last: "2026-10-06", entities: ["intents"] }],
		[...archive, { ...memory[0], archived: "2026-10-06", reason: 'superato da "Intent in docs/intents/."' }, { type: "episodio", text: "Scelto X per Y.", pinned: false, confirmations: 1, last: "2026-10-06", archived: "2026-10-06", reason: "episodio" }],
		prev, "2026-10-06");
	assert.equal(next.find((r) => r.id === "r1")!.status, "superseded");
	const fresh = next.find((r) => r.text.startsWith("Intent in docs"))!;
	assert.equal(fresh.status, "active");
	assert.ok(fresh.entities.includes("intents") && fresh.entities.includes("docs/intents/"));
	assert.ok(!next.some((r) => r.id === fresh.id && r.id === "r1"));
	assert.equal(next.find((r) => r.text.startsWith("Scelto"))!.status, "active");
	assert.equal(new Set(next.map((r) => r.id)).size, next.length);
});
