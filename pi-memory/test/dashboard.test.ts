import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, dreamEntry, memoryStatus, recordLabel, recordPreview, summarize } from "../src/dashboard.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "preferenza", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-06", status: "active", entities: [], ...extra });
const records = [
	rec("r1", "Messaggi d'errore sempre in italiano.", { type: "correzione", pinned: true, confirmations: 3 }),
	rec("r2", "Il package manager è pnpm.", { entities: ["pnpm"] }),
	rec("r3", "Usavamo npm.", { status: "superseded", reason: "superato da \"pnpm\"" }),
	rec("g:r1", "Rispondi in italiano.", { type: "preferenza" }),
];

test("summary: active, pinned, superseded, per type, last /dream, where", () => {
	const text = summarize(records, { lastDream: "2026-10-07", where: ".pi/memory" });
	assert.match(text, /3 attivi · 1 📌 · 1 superato/);
	assert.match(text, /1 correzione · 2 preferenze/);
	assert.match(text, /ultimo \/dream 2026-10-07/);
	assert.match(text, /\.pi\/memory/);
	assert.match(summarize([], {}), /nessun ricordo · fai \/dream/);
});

test("labels and preview of one memory", () => {
	assert.equal(recordLabel(records[0]), "📌 [correzione] Messaggi d'errore sempre in italiano.");
	assert.equal(recordLabel(records[2]), "~ [preferenza] Usavamo npm.");
	assert.equal(recordLabel(records[3]), "[preferenza] Rispondi in italiano. · globale");
	const preview = recordPreview(records[1]);
	assert.match(preview, /Il package manager è pnpm\./);
	assert.match(preview, /tipo: preferenza/);
	assert.match(preview, /entità: pnpm/);
	assert.match(preview, /confermato 1 volta · creato 2026-10-01 · ultimo 2026-10-06/);
	assert.match(recordPreview(records[2]), /superato da "pnpm"/);
});

test("actions: pin toggles, edit changes text, supersede keeps it as superseded, delete removes it", () => {
	assert.equal(applyAction(records, "r2", { kind: "pin" }).find((r) => r.id === "r2")?.pinned, true);
	assert.equal(applyAction(records, "r1", { kind: "pin" }).find((r) => r.id === "r1")?.pinned, false);
	assert.equal(applyAction(records, "r2", { kind: "edit", text: "Il package manager è bun." }).find((r) => r.id === "r2")?.text, "Il package manager è bun.");
	const superseded = applyAction(records, "r2", { kind: "supersede" }, "2026-10-08").find((r) => r.id === "r2");
	assert.equal(superseded?.status, "superseded");
	assert.match(superseded?.reason ?? "", /dall'utente/);
	assert.equal(applyAction(records, "r2", { kind: "delete" }).some((r) => r.id === "r2"), false);
	assert.equal(applyAction(records, "zz", { kind: "delete" }).length, records.length);
	assert.notEqual(applyAction(records, "r2", { kind: "pin" }), records, "never mutates the input");
	assert.equal(records[1].pinned, false);
});

test("memory status for the footer and the panel", () => {
	assert.equal(memoryStatus({ loading: true }), "⠋ carico la memoria…");
	assert.equal(memoryStatus({ dreaming: true }), "⠋ consolido la memoria…");
	assert.equal(memoryStatus({ active: 12, pinned: 2, recalled: 3 }), "◇ 3 ricordi richiamati · 12 (2 📌)");
	assert.equal(memoryStatus({ active: 12, pinned: 0, recalled: 0 }), "◇ 12 ricordi");
	assert.equal(memoryStatus({ active: 0 }), undefined);
});

test("the /dream result as a lasting chat entry", () => {
	const entry = dreamEntry({ added: 3, reinforced: 2, merged: 1, updated: 0, forgotten: 0 }, ["+ [preferenza] Usa pnpm."], { active: 12, pinned: 2, pending: 4 });
	assert.match(entry.title, /Memoria aggiornata · \+3 nuovi · 2 rinforzati · 1 unito/);
	assert.match(entry.title, /12 ricordi \(2 📌\)/);
	assert.deepEqual(entry.lines, ["+ [preferenza] Usa pnpm."]);
	assert.match(entry.footer ?? "", /restano 4 sessioni: rilancia \/dream · \/memory per vederli/);
});
