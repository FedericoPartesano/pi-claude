import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { conversationOf, readPackage } from "./package-view.ts";
import { startViewer } from "./viewer.ts";

function fakePackage(): string {
	const root = mkdtempSync(join(tmpdir(), "view-"));
	const dir = join(root, "pkg", "2026-bug");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "report.json"), JSON.stringify({ pi: "1.0", form: { happened: "<img src=x onerror=alert(1)>" } }));
	writeFileSync(join(dir, "session.jsonl"), [
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "ciao" }] } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "leggo" }, { type: "toolCall", name: "bash", arguments: { command: "ls" } }] } },
		{ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "a b" }] } },
		{ type: "compaction", summary: "riassunto" },
	].map((e) => JSON.stringify(e)).join("\n"));
	mkdirSync(join(dir, "memory"));
	writeFileSync(join(dir, "memory", "memory.md"), "# ricordi");
	const tar = join(root, "pkg.tar.gz");
	spawnSync("tar", ["-czf", tar, "-C", join(root, "pkg"), "2026-bug"]);
	return tar;
}

test("conversationOf: utente, Pi con strumenti, risultati, compattazione", () => {
	const { turns } = conversationOf('{"type":"message","message":{"role":"user","content":"x"}}\nnon json\n{"type":"compaction","summary":"s"}');
	assert.deepEqual(turns.map((t) => t.role), ["user", "note"]);
});

test("readPackage: legge modulo, conversazione e note", () => {
	const tar = fakePackage();
	const out = mkdtempSync(join(tmpdir(), "view-out-"));
	spawnSync("tar", ["-xzf", tar, "-C", out]);
	const pkg = readPackage(join(out, "2026-bug"));
	assert.equal(pkg.conversation.length, 4);
	assert.equal(pkg.conversation[1].tools?.[0].name, "bash");
	assert.equal(pkg.notes[0].name, "memory/memory.md");
});

test("viewer: chiave obbligatoria, Host controllato, lista, dettaglio, stato, elimina", async () => {
	const tar = fakePackage();
	const { readFileSync } = await import("node:fs");
	const calls: string[] = [];
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calls.push(`${init?.method ?? "GET"} ${url}`);
		if (url.endsWith("/admin/bugs")) return new Response(JSON.stringify({ bugs: [{ id: "a1", size: 10, title: "T", status: "new" }] }));
		if (init?.method === "PATCH" || init?.method === "DELETE") return new Response("{}");
		return new Response(readFileSync(tar));
	}) as typeof fetch;
	const viewer = await startViewer({ url: "http://srv", session: { token: "t", expiresAt: 1 }, relogin: async () => undefined, cacheDir: mkdtempSync(join(tmpdir(), "cache-")), fetchImpl });
	try {
		const base = viewer.url.split("/?")[0];
		const key = viewer.url.split("k=")[1];
		assert.equal((await fetch(`${base}/`)).status, 403, "senza chiave");
		assert.equal((await fetch(`${base}/api/bugs`)).status, 403);
		const page = await fetch(viewer.url);
		assert.equal(page.status, 200);
		assert.match(await page.text(), new RegExp(key));
		const headers = { "x-viewer-key": key };
		assert.equal(((await (await fetch(`${base}/api/bugs`, { headers })).json()) as { bugs: unknown[] }).bugs.length, 1);
		const pkg = (await (await fetch(`${base}/api/bugs/a1`, { headers })).json()) as { conversation: unknown[]; report: { form: { happened: string } } };
		assert.equal(pkg.conversation.length, 4);
		assert.equal((await fetch(`${base}/api/bugs/a1/status`, { method: "POST", headers, body: '{"status":"resolved"}' })).status, 200);
		assert.equal((await fetch(`${base}/api/bugs/a1/status`, { method: "POST", headers, body: '{"status":"x"}' })).status, 400);
		assert.equal((await fetch(`${base}/api/bugs/a1`, { method: "DELETE", headers })).status, 200);
		assert.ok(calls.some((c) => c.startsWith("PATCH ")) && calls.some((c) => c.startsWith("DELETE ")));
		assert.equal((await fetch(`${base}/api/bugs/..%2Fx`, { headers })).status, 404);
	} finally {
		viewer.close();
	}
});
