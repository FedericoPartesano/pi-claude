import assert from "node:assert/strict";
import { test } from "node:test";
import caveman, { COMPACTION_RULES, MARKER, RULES, RULES_LITE } from "./caveman.ts";

const load = () => {
	const handlers: Record<string, any> = {};
	caveman({ on: (name: string, h: any) => (handlers[name] = h) } as any);
	return handlers;
};

test("aggiunge le regole una sola volta, senza cambiare il resto", () => {
	const h = load().before_agent_start;
	const out = h({ systemPrompt: "base" });
	assert.equal(out.systemPrompt, `base\n\n${RULES}`);
	assert.equal(h({ systemPrompt: out.systemPrompt }), undefined);
});
test("testo corto e stabile (cache)", () => { assert.ok(RULES.length < 3200); assert.ok(RULES.includes(MARKER)); assert.ok(RULES_LITE.includes(MARKER)); });
test("le regole tengono i fatti: negazioni, numeri, avvisi, chiarezza", () => {
	for (const word of ["negazioni", "percorsi", "avvisi di sicurezza", "azioni irreversibili", "chiarezza"]) assert.ok(RULES.includes(word), word);
	for (const word of ["percorsi", "nomi di funzioni", "negazione"]) assert.ok(COMPACTION_RULES.includes(word), word);
});
test("PI_CAVEMAN=lite usa le regole morbide", () => {
	process.env.PI_CAVEMAN = "lite";
	try { assert.equal(load().before_agent_start({ systemPrompt: "b" }).systemPrompt, `b\n\n${RULES_LITE}`); } finally { delete process.env.PI_CAVEMAN; }
});
test("PI_CAVEMAN=0 lo spegne del tutto", () => {
	process.env.PI_CAVEMAN = "0";
	try { assert.deepEqual(load(), {}); } finally { delete process.env.PI_CAVEMAN; }
});
test("PI_CAVEMAN_COMPACT=0 spegne solo i riassunti", () => {
	process.env.PI_CAVEMAN_COMPACT = "0";
	try { const h = load(); assert.ok(h.before_agent_start); assert.equal(h.session_before_compact, undefined); } finally { delete process.env.PI_CAVEMAN_COMPACT; }
});
test("compattazione: senza modello o senza credenziali lascia fare a Pi", async () => {
	const h = load().session_before_compact;
	assert.equal(await h({ preparation: {}, signal: new AbortController().signal }, { model: undefined }), undefined);
	const ctx = { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "x" }) } };
	assert.equal(await h({ preparation: {}, signal: new AbortController().signal }, ctx), undefined);
	const throwing = { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => { throw new Error("boom"); } } };
	assert.equal(await h({ preparation: {}, signal: new AbortController().signal }, throwing), undefined);
});
