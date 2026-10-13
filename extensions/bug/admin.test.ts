import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bugLabel, downloadBug, listBugs, login, saveSession, savedSession } from "./admin.ts";

const reply = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("login: ok, password sbagliata, server giù", async () => {
	assert.deepEqual(await login("http://x/", "p", reply(200, { token: "t", expiresAt: 5 }) as typeof fetch), { ok: true, session: { token: "t", expiresAt: 5 } });
	assert.deepEqual(await login("http://x", "p", reply(401, { error: "password sbagliata" }) as typeof fetch), { ok: false, message: "password sbagliata" });
	const down = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
	assert.match((await login("http://x", "p", down)).ok ? "" : (await login("http://x", "p", down) as { message: string }).message, /non raggiungibile/);
});

test("sessione salvata: file privato, scade, non salva la password", () => {
	const home = mkdtempSync(join(tmpdir(), "adm-"));
	assert.equal(savedSession(home), undefined);
	saveSession(home, { token: "t", expiresAt: 10_000_000 });
	assert.equal(statSync(join(home, ".pi/agent/bug-admin.json")).mode & 0o777, 0o600);
	assert.deepEqual(savedSession(home, 1000), { token: "t", expiresAt: 10_000_000 });
	assert.equal(savedSession(home, 10_000_000), undefined, "scaduta");
});

test("listBugs: lista, o 'login' se il token non vale più", async () => {
	assert.deepEqual(await listBugs("http://x", { token: "t", expiresAt: 1 }, reply(200, { bugs: [{ id: "1", size: 2048, title: "A" }] }) as typeof fetch), { bugs: [{ id: "1", size: 2048, title: "A" }] });
	assert.equal(await listBugs("http://x", { token: "t", expiresAt: 1 }, reply(401, {}) as typeof fetch), "login");
});

test("downloadBug: scrive il pacchetto senza sovrascrivere", async () => {
	const dir = join(mkdtempSync(join(tmpdir(), "adm-")), "received");
	const fetchImpl = (async () => new Response("DATI")) as typeof fetch;
	const bug = { id: "abcdef123456", size: 4, name: "bug-1.tar.gz" };
	const first = await downloadBug("http://x", { token: "t", expiresAt: 1 }, bug, dir, fetchImpl);
	const second = await downloadBug("http://x", { token: "t", expiresAt: 1 }, bug, dir, fetchImpl);
	assert.notEqual(first, second);
	assert.equal(readFileSync(first, "utf8"), "DATI");
});

test("bugLabel: data, gravità, titolo, dimensione", () => {
	assert.equal(bugLabel({ id: "1", size: 2048, title: "Todo", severity: "blocca", receivedAt: "2026-10-13T10:20:30Z" }), "2026-10-13 10:20 · blocca · Todo · 2 KB");
});
