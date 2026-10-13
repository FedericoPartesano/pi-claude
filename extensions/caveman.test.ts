import assert from "node:assert/strict";
import { test } from "node:test";
import caveman, { MARKER, RULES } from "./caveman.ts";

const load = () => { let handler: any; caveman({ on: (_: string, h: any) => (handler = h) } as any); return handler; };

test("aggiunge le regole una sola volta, senza cambiare il resto", () => {
	const h = load();
	const out = h({ systemPrompt: "base" });
	assert.equal(out.systemPrompt, `base\n\n${RULES}`);
	assert.equal(h({ systemPrompt: out.systemPrompt }), undefined);
});
test("testo corto e stabile (cache)", () => { assert.ok(RULES.length < 2400); assert.ok(RULES.includes(MARKER)); });
test("PI_CAVEMAN=0 lo spegne", () => {
	process.env.PI_CAVEMAN = "0";
	try { assert.equal(load(), undefined); } finally { delete process.env.PI_CAVEMAN; }
});
