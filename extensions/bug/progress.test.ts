import assert from "node:assert/strict";
import { test } from "node:test";
import { sendWithProgress } from "./progress.ts";

const texts = { sending: "Invio", done: (m: string) => `ok ${m}`, failed: (m: string) => `ko ${m}` };
function ui() {
	const log: string[] = [];
	return { log, setStatus: (_k: string, t?: string) => log.push(`status:${t ?? "-"}`), notify: (m: string, t?: string) => log.push(`toast:${t}:${m}`) };
}

test("successo: icona, poi stato pulito e toast info", async () => {
	const u = ui();
	await sendWithProgress(u, async () => ({ ok: true, message: "inviato" }), texts);
	assert.match(u.log[0], /^status:.+ Invio$/);
	assert.deepEqual(u.log.slice(-2), ["status:-", "toast:info:✓ ok inviato"]);
});

test("errore del server: toast error", async () => {
	const u = ui();
	const out = await sendWithProgress(u, async () => ({ ok: false, message: "503" }), texts);
	assert.equal(out.ok, false);
	assert.equal(u.log.at(-1), "toast:error:✗ ko 503");
});

test("eccezione: stato pulito e toast error", async () => {
	const u = ui();
	await sendWithProgress(u, async () => { throw new Error("boom"); }, texts);
	assert.deepEqual(u.log.slice(-2), ["status:-", "toast:error:✗ ko boom"]);
});

test("l'invio lento disegna l'icona una volta sola", async () => {
	const u = ui();
	await sendWithProgress(u, () => new Promise((r) => setTimeout(() => r({ ok: true, message: "x" }), 300)), texts);
	assert.equal(u.log.filter((l) => l.startsWith("status:") && l !== "status:-").length, 1);
});
