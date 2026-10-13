import assert from "node:assert/strict";
import { test } from "node:test";
import title, { chatExcerpt, cleanTitle, MAX_TITLE, parseTitleArgs } from "./title.ts";

test("cleanTitle: toglie virgolette, prefisso, punto, righe extra e controlli", () => {
	assert.equal(cleanTitle('"Titolo: Fix barra di stato."\naltro'), "Fix barra di stato");
	assert.equal(cleanTitle("\n  **Voce da tastiera**  "), "Voce da tastiera");
	assert.equal(cleanTitle("a\u001b[31mb"), "a[31mb");
	assert.equal(cleanTitle("  \n "), undefined);
	assert.equal(cleanTitle("x".repeat(200))?.length, MAX_TITLE);
});

test("parseTitleArgs", () => {
	assert.deepEqual(parseTitleArgs("  "), { action: "show" });
	assert.deepEqual(parseTitleArgs("AUTO"), { action: "auto" });
	assert.deepEqual(parseTitleArgs("  fix\n  tab  "), { action: "set", name: "fix tab" });
	assert.equal((parseTitleArgs("y".repeat(300)) as { name: string }).name.length, MAX_TITLE);
});

test("chatExcerpt: primo messaggio e prima risposta, niente senza utente", () => {
	const branch = [
		{ type: "custom", customType: "x" },
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "ciao" }] } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "salve" }] } },
		{ type: "message", message: { role: "user", content: "secondo" } },
	];
	assert.equal(chatExcerpt(branch), "User: ciao\n\nAssistant: salve");
	assert.equal(chatExcerpt([]), undefined);
});

test("/title imposta, mostra; auto non scatta se la chat ha già un nome", () => {
	const commands: Record<string, { handler: (a: string, c: unknown) => Promise<void> }> = {};
	const on: Record<string, (e: unknown, c: unknown) => void> = {};
	let name: string | undefined;
	title({ registerCommand: (n: string, o: never) => (commands[n] = o), on: (n: string, f: never) => (on[n] = f), setSessionName: (n: string) => (name = n), getSessionName: () => name } as never);
	const notes: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (t: string) => notes.push(t) }, sessionManager: { getSessionId: () => "s", getBranch: () => [] } };
	return (async () => {
		await commands.title.handler("Bug viewer", ctx);
		assert.equal(name, "Bug viewer");
		await commands.title.handler("", ctx);
		assert.match(notes.at(-1)!, /Titolo: Bug viewer/);
		on.agent_end({}, { ...ctx, modelRegistry: { find: () => { throw new Error("non deve chiamare il modello"); } } });
	})();
});

test("PI_TITLE=0 non registra nulla; PI_TITLE_AUTO=0 niente agent_end", () => {
	const seen: string[] = [];
	const api = { registerCommand: () => seen.push("cmd"), on: (n: string) => seen.push(n) } as never;
	process.env.PI_TITLE = "0";
	try { title(api); } finally { delete process.env.PI_TITLE; }
	assert.deepEqual(seen, []);
	process.env.PI_TITLE_AUTO = "0";
	try { title(api); } finally { delete process.env.PI_TITLE_AUTO; }
	assert.deepEqual(seen, ["cmd"]);
});
