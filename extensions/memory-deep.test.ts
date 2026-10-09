import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProposal, buildDreamPrompt, filterProposal, parseProposal } from "./memory-core.ts";
import { entriesToRecords, recordsToEntries } from "../pi-memory/src/reconcile.ts";
import type { MemoryRecord } from "../pi-memory/src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("parseProposal keeps entities (bounded, strings only)", () => {
	const parsed = parseProposal('{"add":[{"type":"fatto","text":"x in y","entities":["totalValue","src/a.ts",3,"' + "z".repeat(80) + '"]}],"update":[{"id":"m1","text":"nuovo","entities":["a"]}]}', 1);
	assert.ok(parsed.ok);
	if (parsed.ok) {
		assert.deepEqual(parsed.proposal.add[0].entities, ["totalValue", "src/a.ts"]);
		assert.deepEqual(parsed.proposal.update[0].entities, ["a"]);
	}
});

test("applyProposal carries entities and ids; entries without entities stay unchanged in shape", () => {
	const memory = [{ id: "r1", type: "decisione", text: "Intent in intent/.", pinned: false, confirmations: 2, last: "2026-10-01", entities: ["intent"] }, { type: "fatto", text: "Altro.", pinned: false, confirmations: 1, last: "2026-10-01" }];
	const result = applyProposal(memory, [], { add: [{ type: "fatto", text: "Usa unit_price.", entities: ["unit_price"] }], reinforce: ["m2"], merge: [], update: [{ id: "m1", text: "Intent in docs/intents/.", entities: ["intents"] }], forget: [] }, "2026-10-07");
	assert.equal(result.archive[0].id, "r1");
	assert.deepEqual(result.memory.find((entry) => entry.text.startsWith("Usa"))!.entities, ["unit_price"]);
	assert.deepEqual(result.memory.find((entry) => entry.text.startsWith("Intent"))!.entities, ["intents"]);
	assert.ok(!("entities" in result.memory.find((entry) => entry.text === "Altro.")!));
});

test("deep dream: no cap, the excess stays active; update supersedes; episodes recallable", () => {
	let records: MemoryRecord[] = Array.from({ length: 400 }, (_, i) => rec(`r${i + 1}`, `Ricordo numero ${i + 1} sul modulo ${i % 30}.`));
	const { memory, archive } = recordsToEntries(records);
	const applied = applyProposal(memory, archive, {
		add: [{ type: "episodio", text: "Scelto Postgres perché serve JSONB." }, { type: "fatto", text: "Nuovo fatto sul modulo 7 con totalValue.", entities: ["totalValue"] }],
		reinforce: [], merge: [], update: [{ id: "m1", text: "Ricordo uno aggiornato." }], forget: [],
	}, "2026-10-07");
	records = entriesToRecords(applied.memory, applied.archive, records, "2026-10-07");
	assert.equal(records.filter((r) => r.status === "active").length, 400 - 1 + 1 + 1 + 1); // 399 + updated + episode + new
	assert.equal(records.find((r) => r.id === "r1")!.status, "superseded");
	assert.equal(records.find((r) => r.text.startsWith("Scelto"))!.status, "active");
	assert.ok(records.find((r) => r.text.startsWith("Nuovo fatto"))!.entities.includes("totalvalue"));
});

test("deep dream prompt asks for entities and does not mention the cap", () => {
	const prompt = buildDreamPrompt([], "sessione", "2026-10-07", { deep: true });
	assert.match(prompt, /"entities"/);
	assert.doesNotMatch(prompt, /spazio|tetto/);
});

test("parseProposal keeps links (existing ids only), a short gist and the level", () => {
	const text = JSON.stringify({ add: [{ type: "decisione", text: "La coda reports ha concorrenza 1 per la RAM del pod da 512MB", entities: ["reports"], links: ["m1", "m9"], gist: "coda reports: concorrenza 1 (RAM)", level: "progetto" }, { type: "preferenza", text: "Risposte sempre in italiano", level: "personale" }] });
	const parsed = parseProposal(text, 2);
	assert.ok(parsed.ok);
	assert.deepEqual(parsed.proposal.add[0].links, ["m1"]);
	assert.equal(parsed.proposal.add[0].gist, "coda reports: concorrenza 1 (RAM)");
	assert.equal(parsed.proposal.add[1].level, "personale");
});

test("applyProposal turns links m<n> into the memories' ids and carries gist and level", () => {
	const memory = [{ id: "r7", type: "fatto", text: "ReportBuilder accoda su reports", pinned: false, confirmations: 1, last: "2026-10-01" }];
	const applied = applyProposal(memory, [], { add: [{ type: "decisione", text: "La coda reports ha concorrenza 1", links: ["m1"], gist: "reports: concorrenza 1", level: "progetto" }], reinforce: [], merge: [], update: [], forget: [] }, "2026-10-09");
	const added = applied.memory.find((entry) => entry.text.startsWith("La coda"))!;
	assert.deepEqual(added.links, ["r7"]);
	assert.equal(added.gist, "reports: concorrenza 1");
});

test("filterProposal: no-content memories are dropped, near-duplicates become confirmations, a real lesson stays", () => {
	const memory = [{ id: "r1", type: "preferenza", text: "Il package manager del progetto è pnpm, non npm", pinned: false, confirmations: 1, last: "2026-10-01" }];
	const proposal = {
		add: [
			{ type: "episodio" as const, text: "Sessione 2026-10-07: utente ha inviato messaggi casuali ripetuti (asd, as, da, etc.) senza richieste chiare. Pi ha risposto chiedendo chiarimenti. Utente ha digitato 'clear' aspettandosi di cancellare la conversazione." },
			{ type: "preferenza" as const, text: "Il package manager del progetto è pnpm e non npm" },
			{ type: "episodio" as const, text: "L'export Excel andava in OOM col pod da 512MB: risolto con exceljs in streaming", entities: ["exceljs"] },
			{ type: "fatto" as const, text: "ok" },
		],
		reinforce: [],
		merge: [],
		update: [],
		forget: [],
	};
	const { proposal: kept, dropped } = filterProposal(proposal, memory);
	assert.deepEqual(kept.add.map((item) => item.text), ["L'export Excel andava in OOM col pod da 512MB: risolto con exceljs in streaming"]);
	assert.deepEqual(kept.reinforce, ["m1"]);
	assert.equal(dropped.length, 3);
});

test("the deep dream prompt asks for links, gist and level, and says what not to save", () => {
	const prompt = buildDreamPrompt([], "## Sessione\nUtente: ciao", "2026-10-09", { deep: true });
	assert.match(prompt, /"links"/);
	assert.match(prompt, /"gist"/);
	assert.match(prompt, /personale/);
	assert.match(prompt, /NON salvare/);
});

test("the overview: /dream proposes a 'quadro' (clipped to 1200 chars) and the prompt shows the current one", () => {
	const parsed = parseProposal(JSON.stringify({ add: [], quadro: `Progetto: gestionale ordini. ${"x".repeat(2000)}` }), 0);
	assert.ok(parsed.ok);
	assert.equal(parsed.proposal.quadro?.length, 1200);
	const prompt = buildDreamPrompt([], "## Sessione\nUtente: ciao", "2026-10-09", { deep: true, quadro: "Progetto: gestionale ordini in NestJS." });
	assert.match(prompt, /Quadro attuale/);
	assert.match(prompt, /gestionale ordini in NestJS/);
	assert.match(prompt, /"quadro"/);
});

test("new memories of the same /dream can link each other (n<k> = k-th addition) and the ids are resolved", () => {
	const parsed = parseProposal(JSON.stringify({ add: [
		{ type: "fatto", text: "L'export delle fatture usa ReportBuilder", links: ["n2"] },
		{ type: "decisione", text: "La coda reports resta a concorrenza 1 per la RAM del pod", links: ["n1", "n9"] },
	] }), 0);
	assert.ok(parsed.ok);
	assert.deepEqual(parsed.proposal.add[0].links, ["n2"]);
	assert.deepEqual(parsed.proposal.add[1].links, ["n1"], "n9 does not exist");
	const applied = applyProposal([], [], parsed.proposal, "2026-10-09");
	const records = entriesToRecords(applied.memory, applied.archive, [], "2026-10-09");
	const [exportRecord, queueRecord] = records;
	assert.deepEqual(exportRecord.links, [queueRecord.id]);
	assert.deepEqual(queueRecord.links, [exportRecord.id]);
});

test("n<k> links survive filtering: they follow the model's own numbering, not positions after a drop", () => {
	const parsed = parseProposal(JSON.stringify({ add: [
		{ type: "episodio", text: "L'utente ha inviato messaggi casuali (asd) senza richieste chiare" },
		{ type: "fatto", text: "L'export delle fatture usa ReportBuilder", links: ["n3"] },
		{ type: "decisione", text: "La coda reports resta a concorrenza 1 per la RAM del pod" },
	] }), 0);
	assert.ok(parsed.ok);
	const filtered = filterProposal(parsed.proposal, []).proposal;
	assert.equal(filtered.add.length, 2);
	const records = entriesToRecords(applyProposal([], [], filtered, "2026-10-09").memory, [], [], "2026-10-09");
	const exportRecord = records.find((record) => record.text.startsWith("L'export"))!;
	const queueRecord = records.find((record) => record.text.startsWith("La coda"))!;
	assert.deepEqual(exportRecord.links, [queueRecord.id]);
});

test("merge and update keep the graph and the usage: links and uses carried over, links to them redirected, dangling ones pruned", () => {
	const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-01-01", last: "2026-05-01", status: "active", entities: [], ...extra });
	const records = [
		rec("r1", "Il deploy usa GitHub Actions", { links: ["r9"], uses: 4, lastUsed: "2026-09-01" }),
		rec("r2", "I rilasci partono dal branch release", { uses: 2 }),
		rec("r3", "La coda reports ha concorrenza 2", { links: ["r1"], uses: 5, lastUsed: "2026-09-20" }),
		rec("r4", "Il changelog si genera al rilascio", { links: ["r2", "r3"] }),
	];
	const { memory, archive } = recordsToEntries(records);
	const applied = applyProposal(memory, archive, {
		add: [],
		reinforce: [],
		merge: [{ ids: ["m1", "m2"], text: "Il deploy usa GitHub Actions dal branch release" }],
		update: [{ id: "m3", text: "La coda reports ha concorrenza 1" }],
		forget: [],
	}, "2026-10-09");
	const out = entriesToRecords(applied.memory, applied.archive, records, "2026-10-09", 4);
	const merged = out.find((record) => record.text.startsWith("Il deploy usa GitHub Actions dal"))!;
	const updated = out.find((record) => record.text === "La coda reports ha concorrenza 1")!;
	const changelog = out.find((record) => record.id === "r4")!;
	assert.equal(merged.uses, 6, "uses of the merged memories add up");
	assert.equal(merged.lastUsed, "2026-09-01");
	assert.equal(updated.uses, 5);
	assert.deepEqual(updated.links, [merged.id], "the update keeps its link, redirected to the merged memory");
	assert.deepEqual(changelog.links?.sort(), [merged.id, updated.id].sort(), "links to merged/updated memories follow them");
	assert.ok(!(merged.links ?? []).includes("r9"), "a link to a memory that does not exist is pruned");
});
