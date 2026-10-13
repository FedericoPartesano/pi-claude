import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import caveman, { COMPACTION_RULES, MARKER, RULES, RULES_LITE } from "./caveman.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "cav-"));
const load = () => {
	const handlers: Record<string, any> = {}; let command: any;
	caveman({ on: (name: string, h: any) => (handlers[name] = h), registerCommand: (_: string, c: any) => (command = c) } as any);
	return { ...handlers, command } as Record<string, any>;
};
const withEnv = (value: string | undefined, fn: () => void) => {
	const before = process.env.PI_CAVEMAN;
	if (value === undefined) delete process.env.PI_CAVEMAN; else process.env.PI_CAVEMAN = value;
	try { fn(); } finally { if (before === undefined) delete process.env.PI_CAVEMAN; else process.env.PI_CAVEMAN = before; }
};
const ctxWith = (log: string[]) => ({ hasUI: true, ui: { setStatus: (_k: string, v: string) => log.push(`status:${v}`), notify: (m: string) => log.push(`notify:${m}`) } });

test("aggiunge le regole una sola volta, senza cambiare il resto", () => withEnv(undefined, () => {
	const h = load().before_agent_start;
	const out = h({ systemPrompt: "base" });
	assert.equal(out.systemPrompt, `base\n\n${RULES}`);
	assert.equal(h({ systemPrompt: out.systemPrompt }), undefined);
}));
test("testo corto e stabile (cache)", () => { assert.ok(RULES.length < 3200); assert.ok(RULES.includes(MARKER)); assert.ok(RULES_LITE.includes(MARKER)); });
test("le regole tengono i fatti: negazioni, numeri, avvisi, chiarezza", () => {
	for (const word of ["negazioni", "percorsi", "avvisi di sicurezza", "azioni irreversibili", "chiarezza"]) assert.ok(RULES.includes(word), word);
	for (const word of ["percorsi", "nomi di funzioni", "negazione"]) assert.ok(COMPACTION_RULES.includes(word), word);
});
test("PI_CAVEMAN=lite usa le regole morbide", () => withEnv("lite", () => {
	assert.equal(load().before_agent_start({ systemPrompt: "b" }).systemPrompt, `b\n\n${RULES_LITE}`);
}));
test("PI_CAVEMAN=0 non aggiunge niente", () => withEnv("0", () => {
	assert.equal(load().before_agent_start({ systemPrompt: "b" }), undefined);
}));
test("PI_CAVEMAN_COMPACT=0 spegne solo i riassunti", () => {
	process.env.PI_CAVEMAN_COMPACT = "0";
	try { const h = load(); assert.ok(h.before_agent_start); assert.equal(h.session_before_compact, undefined); } finally { delete process.env.PI_CAVEMAN_COMPACT; }
});
test("compattazione: senza modello o senza credenziali lascia fare a Pi", async () => {
	delete process.env.PI_CAVEMAN;
	const h = load().session_before_compact;
	assert.equal(await h({ preparation: {}, signal: new AbortController().signal }, { model: undefined }), undefined);
	const ctx = { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "x" }) } };
	assert.equal(await h({ preparation: {}, signal: new AbortController().signal }, ctx), undefined);
	const throwing = { model: { id: "m" }, modelRegistry: { getApiKeyAndHeaders: async () => { throw new Error("boom"); } } };
	assert.equal(await h({ preparation: {}, signal: new AbortController().signal }, throwing), undefined);
});
test("badge nel footer: lite, full, off", () => {
	for (const [env, expected] of [[undefined, "full"], ["1", "full"], ["lite", "lite"], ["0", "off"]] as const) withEnv(env, () => {
		const log: string[] = []; load().session_start({}, ctxWith(log));
		assert.deepEqual(log, [`status:${expected}`]);
	});
});
test("/caveman cambia livello subito, aggiorna il badge e lo ricorda", () => withEnv(undefined, () => {
	const h = load(); const log: string[] = []; const ctx = ctxWith(log);
	let prompt = h.before_agent_start({ systemPrompt: "b" }).systemPrompt;
	assert.equal(prompt, `b\n\n${RULES}`);
	h.command.handler("lite", ctx);
	assert.ok(log.includes("status:lite"));
	prompt = h.before_agent_start({ systemPrompt: prompt }).systemPrompt;
	assert.equal(prompt, `b\n\n${RULES_LITE}`);
	h.command.handler("off", ctx);
	assert.equal(h.before_agent_start({ systemPrompt: prompt }).systemPrompt, "b");
	h.command.handler("full", ctx);
	h.command.handler("lite", ctx);
	assert.equal(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, "caveman-level"), "utf8"), "lite");
	const again: string[] = []; load().session_start({}, ctxWith(again));
	assert.deepEqual(again, ["status:lite"]); // nuova sessione: riparte dall'ultima scelta
	h.command.handler("boh", ctx);
	assert.ok(log.at(-1)!.startsWith("notify:Livelli"));
}));
