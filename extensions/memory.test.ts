import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyProposal,
	bm25Search,
	buildDreamPrompt,
	findProjectSessions,
	fitBudget,
	lookback,
	maskSecrets,
	parseMemory,
	parseProposal,
	renderMemory,
	staleIds,
	type MemoryEntry,
} from "./memory-core.ts";

const MEMORY = `# Memoria di Pi
<!-- gestita da /dream: modificabile a mano -->
- [correzione] Prezzi sempre in centesimi interi, mai float. (conferme: 3 · ultima: 2026-10-06)
- [preferenza] Niente commit senza richiesta esplicita. 📌 (conferme: 5 · ultima: 2026-10-05)
- [decisione] Intent in intents/, non intent/. (conferme: 1 · ultima: 2026-10-06)
- [fatto] Il test di totalValue è rotto da prima. (conferme: 2 · ultima: 2026-06-01)
`;

const entry = (text: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({ type: "fatto", text, pinned: false, confirmations: 1, last: "2026-10-01", ...extra });

test("parse and render memory round-trip", () => {
	const entries = parseMemory(MEMORY);
	assert.equal(entries.length, 4);
	assert.deepEqual(entries[1], { type: "preferenza", text: "Niente commit senza richiesta esplicita.", pinned: true, confirmations: 5, last: "2026-10-05" });
	assert.equal(renderMemory(entries), MEMORY);
	// Hand-written lines without metadata are accepted.
	assert.deepEqual(parseMemory("- [preferenza] Rispondi in italiano.")[0], { type: "preferenza", text: "Rispondi in italiano.", pinned: false, confirmations: 1, last: "" });
});

test("archive lines keep why they were archived", () => {
	const archive = parseMemory("- [preferenza] Script in italiano. (conferme: 2 · ultima: 2026-03-01 · archiviato: 2026-07-01 · motivo: superato da \"Script in inglese.\")\n");
	assert.equal(archive[0].archived, "2026-07-01");
	assert.equal(archive[0].reason, 'superato da "Script in inglese."');
	assert.match(renderMemory(archive, "archive"), /archiviato: 2026-07-01 · motivo: superato/);
});

test("applyProposal: add, reinforce, merge, update (old → archive), forget (pinned survives)", () => {
	const memory = parseMemory(MEMORY);
	const result = applyProposal(memory, [], {
		add: [{ type: "correzione", text: "Messaggi d'errore in italiano." }, { type: "decisione", text: "Intent in intents/, non intent/." }],
		reinforce: ["m1"],
		merge: [],
		update: [{ id: "m3", text: "Intent in docs/intents/." }],
		forget: [{ id: "m4", reason: "sbiadito" }, { id: "m2", reason: "prova" }],
	}, "2026-10-07");
	const texts = result.memory.map((item) => item.text);
	assert.deepEqual(texts, ["Prezzi sempre in centesimi interi, mai float.", "Niente commit senza richiesta esplicita.", "Intent in docs/intents/.", "Messaggi d'errore in italiano."]);
	assert.equal(result.memory[0].confirmations, 4);
	assert.equal(result.memory[0].last, "2026-10-07");
	assert.equal(result.memory[2].confirmations, 2); // updated keeps history of confirmations
	assert.deepEqual(result.archive.map((item) => item.reason), ['superato da "Intent in docs/intents/."', "sbiadito"]);
	assert.deepEqual(result.counts, { added: 1, reinforced: 1, merged: 0, updated: 1, forgotten: 1 });
});

test("applyProposal: merge joins duplicates and sums confirmations", () => {
	const memory = [entry("Usa i centesimi.", { confirmations: 2 }), entry("Prezzi in centesimi interi.", { confirmations: 3, pinned: true }), entry("Altro.")];
	const result = applyProposal(memory, [], { add: [], reinforce: [], merge: [{ ids: ["m1", "m2"], text: "Prezzi sempre in centesimi interi.", type: "correzione" }], update: [], forget: [] }, "2026-10-07");
	assert.equal(result.memory.length, 2);
	assert.deepEqual(result.memory[0], { type: "correzione", text: "Prezzi sempre in centesimi interi.", pinned: true, confirmations: 6, last: "2026-10-07" });
});

test("parseProposal: accepts fenced JSON, rejects garbage, skips only the invalid items", () => {
	const ok = parseProposal('Ecco:\n```json\n{"add":[{"type":"correzione","text":"x"}],"reinforce":["m1"]}\n```', 2);
	assert.ok(ok.ok);
	if (ok.ok) assert.deepEqual(ok.proposal.forget, []);
	assert.equal(parseProposal("non è json", 2).ok, false);
	// One bad item (unknown id, measured: it discarded a whole consolidation) must not discard the valid ones.
	const mixed = parseProposal('{"add":[{"type":"correzione","text":"centesimi interi"},{"type":"boh","text":"x"}],"reinforce":["m9","m1"]}', 2);
	assert.ok(mixed.ok);
	if (mixed.ok) {
		assert.deepEqual(mixed.proposal.add.map((item) => item.text), ["centesimi interi"]);
		assert.deepEqual(mixed.proposal.reinforce, ["m1"]);
		assert.match(mixed.skipped.join(" "), /m9/);
	}
});

test("credentials never become memories, even in plain words (measured leak: 'password del gestionale (Gattino!2024)')", () => {
	assert.doesNotMatch(maskSecrets("la password del gestionale è Gattino!2024, usala"), /Gattino/);
	assert.doesNotMatch(maskSecrets("chiave API fornitore: xk29-Fq77-pp0"), /xk29/);
	const proposal = parseProposal('{"add":[{"type":"fatto","text":"Chiave API fornitore e password gestionale (Gattino!2024) per il prossimo lavoro."},{"type":"correzione","text":"Prezzi in centesimi interi."}]}', 0);
	assert.ok(proposal.ok);
	if (proposal.ok) assert.deepEqual(proposal.proposal.add.map((item) => item.text), ["Prezzi in centesimi interi."]);
});

test("maskSecrets hides keys and passwords but keeps normal text", () => {
	const text = "chiave sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 e ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 AKIAABCDEFGHIJKLMNOP Bearer eyJhbGciOiJIUzI1NiJ9.abc.def password=Segreta123 hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ok prezzi in centesimi";
	const masked = maskSecrets(text);
	for (const secret of ["sk-ant-api03", "ghp_ABC", "AKIAABC", "eyJhbGci", "Segreta123", "9f86d081884c"]) assert.ok(!masked.includes(secret), secret);
	assert.match(masked, /ok prezzi in centesimi/);
});

const session = (cwd: string, lines: object[]) => [{ type: "session", version: 3, id: "x", timestamp: "2026-10-01T10:00:00.000Z", cwd }, ...lines].map((line) => JSON.stringify(line)).join("\n") + "\n";
const msg = (role: string, text: string, timestamp: string) => ({ type: "message", id: Math.random().toString(36).slice(2), timestamp, message: { role, content: [{ type: "text", text }] } });

test("findProjectSessions reads the cwd from the first line, lookback keeps user and final assistant text", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-sessions-"));
	mkdirSync(join(root, "a"));
	mkdirSync(join(root, "b"));
	writeFileSync(join(root, "a", "1.jsonl"), session("/proj", [
		msg("user", "aggiungi averagePrice", "2026-10-01T10:00:01.000Z"),
		{ type: "message", timestamp: "2026-10-01T10:00:02.000Z", message: { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }] } },
		msg("toolResult", "OUTPUT ENORME DA NON TENERE", "2026-10-01T10:00:03.000Z"),
		msg("assistant", "Fatto, restituisce euro con decimali.", "2026-10-01T10:00:04.000Z"),
		msg("user", "no, te l'ho già detto: sempre centesimi interi! password=abc12345", "2026-10-01T10:00:05.000Z"),
	]));
	writeFileSync(join(root, "a", "old.jsonl"), session("/proj", [msg("user", "vecchia", "2026-09-01T10:00:00.000Z")]));
	utimesSync(join(root, "a", "old.jsonl"), new Date("2026-09-01"), new Date("2026-09-01"));
	writeFileSync(join(root, "b", "1.jsonl"), session("/altro", [msg("user", "altro progetto", "2026-10-01T10:00:00.000Z")]));
	const files = findProjectSessions(root, "/proj");
	assert.equal(files.length, 2);
	const text = lookback(files, { since: "2026-09-15T00:00:00.000Z", maxChars: 10_000 });
	assert.match(text, /Utente: aggiungi averagePrice/);
	assert.match(text, /Pi: Fatto, restituisce euro/);
	assert.match(text, /sempre centesimi interi/);
	assert.ok(!text.includes("OUTPUT ENORME"));
	assert.ok(!text.includes("abc12345"));
	assert.ok(!text.includes("vecchia"));
	assert.ok(lookback(files, { since: "", maxChars: 80 }).length <= 80);
});

test("bm25Search finds the relevant archived memory", () => {
	const archive = [entry("Il cliente Rossi se n'è andato per i ritardi nelle consegne."), entry("Script in italiano."), entry("Prezzi in centesimi.")];
	const hits = bm25Search(archive, "perché è andato via il cliente Rossi?", 2);
	assert.equal(hits[0].text, archive[0].text);
	assert.deepEqual(bm25Search(archive, "zzz", 3), []);
});

test("buildDreamPrompt numbers the memory and stays compact", () => {
	const prompt = buildDreamPrompt(parseMemory(MEMORY), "## Sessione\nUtente: ciao", "2026-10-07");
	assert.match(prompt, /m1 \[correzione\] Prezzi sempre in centesimi/);
	assert.match(prompt, /"add"/);
	assert.ok(prompt.length < 3500, String(prompt.length));
});
