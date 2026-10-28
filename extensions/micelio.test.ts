import { test } from "node:test";
import assert from "node:assert/strict";
import { cardLines, decodeRpcReply, keywordsOf, parseMemories, visibleLength, type Memory, type Paint } from "./micelio/memories.ts";
import { MicelioClient } from "./micelio/client.ts";

const SAMPLE = `### Struttura del monorepo: app e lib
[reference] id:f276215bb92b · salvatore · 2026-10-19  #monorepo #nx
RADICE · Architettura
Fonte: documento «Monorepo-Structure.md»

Monorepo pnpm + Nx con:
- \`apps/\`: BE NestJS

---

### Query seed E2E
[gotcha] id:aaa111 · fede · 2026-10-23  #e2e
⚠ CODICE CAMBIATO dopo questo ricordo

Il documento smlquery deve avere queryBody.

=== RADICI PERTINENTI ===

### Struttura del monorepo: app e lib
[reference] id:f276215bb92b · salvatore · 2026-10-19  #monorepo`;

test("parses recall text into memories, as sent, without duplicates", () => {
	const memories = parseMemories(SAMPLE);
	assert.deepEqual(memories.map((memory) => memory.id), ["f276215bb92b", "aaa111"]);
	assert.equal(memories[0]?.type, "reference");
	assert.equal(memories[0]?.title, "Struttura del monorepo: app e lib");
	assert.equal(memories[0]?.tags, "#monorepo #nx");
	assert.equal(memories[0]?.body, "Monorepo pnpm + Nx con:\n- apps/: BE NestJS");
	assert.match(memories[1]?.body ?? "", /CODICE CAMBIATO/);
});

test("text without memories gives none", () => {
	assert.deepEqual(parseMemories(""), []);
	assert.deepEqual(parseMemories("Nessun ricordo trovato."), []);
});

test("keywords drop filler and keep the longest words", () => {
	assert.equal(keywordsOf("guarda sul dashboard dell'impallinatura reticoli con calma"), "impallinatura dashboard reticoli calma");
	assert.equal(keywordsOf("ok si no"), "");
});

test("decodes a JSON reply and a server-sent-events reply", () => {
	assert.deepEqual(decodeRpcReply("application/json", `{"id":1,"result":{"ok":true}}`), { id: 1, result: { ok: true } });
	const sse = `event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[]}}\n\n`;
	assert.deepEqual(decodeRpcReply("text/event-stream", sse), { jsonrpc: "2.0", id: 2, result: { content: [] } });
	assert.throws(() => decodeRpcReply("text/event-stream", "event: ping\n\n"));
});

const plain: Paint = { chip: (_type, text) => text, title: (text) => text, dim: (text) => text, frame: (text) => text };
const memory: Memory = { id: "x", type: "gotcha", title: "Un titolo molto lungo che non sta in una riga sola della card", author: "fede", date: "2026-10-23", tags: "#a #b", body: "Prima riga.\n\nSeconda riga del corpo." };

test("a closed card is 4 rows, every row as wide as the card", () => {
	const rows = cardLines(memory, 40, false, false, plain);
	assert.equal(rows.length, 4);
	for (const row of rows) assert.equal(visibleLength(row), 40);
	assert.match(rows[1] ?? "", /…/);
});

test("an open card shows the whole title and the body", () => {
	const rows = cardLines(memory, 40, true, true, plain);
	const text = rows.join("\n");
	assert.match(text, /della card/); // the title wraps, it is not cut
	assert.doesNotMatch(text, /…/);
	assert.match(text, /id:x/);
	assert.match(text, /Seconda riga del corpo\./);
	for (const row of rows) assert.equal(visibleLength(row), 40);
});

test("the client opens a session, calls recall and sends the config header", async () => {
	const calls: { body: { method: string }; headers: Record<string, string> }[] = [];
	const fetcher = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
		const body = JSON.parse(init.body) as { method: string; id?: number };
		calls.push({ body, headers: init.headers });
		if (body.method === "initialize") return new Response(`{"jsonrpc":"2.0","id":1,"result":{}}`, { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
		if (body.method === "notifications/initialized") return new Response("", { status: 202 });
		return new Response(`data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ciao"}]}}\n\n`, { headers: { "content-type": "text/event-stream" } });
	}) as unknown as typeof fetch;
	const client = new MicelioClient({ url: "http://x/mcp", headers: { authorization: "t" } }, fetcher);
	assert.equal(await client.recall("monorepo"), "ciao");
	assert.deepEqual(calls.map((call) => call.body.method), ["initialize", "notifications/initialized", "tools/call"]);
	assert.equal(calls[2]?.headers["mcp-session-id"], "s1");
	assert.equal(calls[2]?.headers.authorization, "t");
});

test("an unreachable Micelio rejects, it does not hang", async () => {
	const client = new MicelioClient({ url: "http://x/mcp", headers: {} }, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
	await assert.rejects(client.recall("monorepo"), /ECONNREFUSED/);
});
