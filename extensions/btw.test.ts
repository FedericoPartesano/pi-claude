import assert from "node:assert/strict";
import { test } from "node:test";
import btw, { btwModel, btwPrompt, looksLikeToolText } from "./btw.ts";

test("btwPrompt: chat, storico, reminder e domanda in ordine", () => {
	const out = btwPrompt("User: a", [{ question: "q1", answer: "a1" }], "q2");
	assert.ok(out.indexOf("Recent chat") < out.indexOf("Earlier side") && out.indexOf("Earlier side") < out.indexOf("<system-reminder>") && out.endsWith("Question: q2"));
	assert.ok(!btwPrompt("", [], "x").includes("Recent chat"));
});

test("looksLikeToolText", () => {
	assert.equal(looksLikeToolText("ok <function_calls><invoke name=x>"), true);
	assert.equal(looksLikeToolText("risposta normale"), false);
});

test("btwModel: claude-code usa il modello attivo, altrimenti sonnet", () => {
	delete process.env.PI_BTW_MODEL;
	assert.equal(btwModel({ model: { provider: "claude-code", id: "opus" } } as never), "opus");
	assert.equal(btwModel({ model: { provider: "x", id: "y" } } as never), "sonnet");
});

test("/btw senza testo chiude il widget; con testo mostra la risposta (claude finto)", async () => {
	const commands: Record<string, (a: string, c: unknown) => Promise<void>> = {};
	btw({ registerCommand: (n: string, o: { handler: never }) => (commands[n] = o.handler) } as never);
	const widgets: unknown[] = [];
	const ctx = { cwd: process.cwd(), model: { provider: "claude-code", id: "haiku" }, sessionManager: { getBranch: () => [] }, ui: { setWidget: (_k: string, v: unknown) => widgets.push(v) } };
	process.env.PI_CLAUDE_BINARY = "/bin/cat";
	await commands.btw("", ctx);
	assert.equal(widgets.at(-1), undefined);
	await commands.btw("ciao", ctx); // cat fails on unknown flags -> error path shown, never throws
	assert.ok(Array.isArray(widgets.at(-1)));
	delete process.env.PI_CLAUDE_BINARY;
});
