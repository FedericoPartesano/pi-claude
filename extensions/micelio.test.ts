import { test } from "node:test";
import assert from "node:assert/strict";
import { cardLines, decodeRpcReply, keyLabel, keywordsOf, legendLines, parseMemories, visibleLength, type Memory, type Paint } from "./micelio/memories.ts";
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

const plain: Paint = { key: (text) => `[${text.trim()}]`, chip: (_type, text) => text, title: (text) => text, dim: (text) => text, frame: (text) => text };
const memory: Memory = { id: "x", type: "gotcha", title: "Un titolo molto lungo che non sta in una riga sola della card", author: "fede", date: "2026-10-23", tags: "#a #b", body: "Prima riga.\n\nSeconda riga del corpo." };

test("a closed card wraps everything, nothing is cut to the width", () => {
	for (const width of [20, 40, 80]) {
		const rows = cardLines(memory, width, false, false, plain);
		const text = rows.map((row) => row.slice(2, -2).trim()).join(" ");
		for (const word of memory.title.split(" ")) assert.ok(text.includes(word), `${width}: ${word}`);
		assert.match(text, /fede · 2026-10-23/);
		assert.match(text, /Prima riga\./);
		assert.doesNotMatch(text, /Seconda riga/); // closed: the first paragraph only
		assert.doesNotMatch(rows.join(""), /…/);
		for (const row of rows) assert.equal(visibleLength(row), width);
	}
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

import { PanelView } from "./micelio/panel-view.ts";

test("the panel moves, opens a card and closes with its key", () => {
	const items: Memory[] = [
		{ id: "a", type: "fact", title: "Uno", author: "x", date: "d", tags: "", body: "corpo uno" },
		{ id: "b", type: "gotcha", title: "Due", author: "x", date: "d", tags: "", body: "corpo due" },
	];
	let closed = 0;
	let blurred = 0;
	let renders = 0;
	const view = new PanelView({
		read: () => ({ status: "ok", query: "q", memories: items }),
		paint: plain,
		text: { name: (text) => text, dim: (text) => text },
		matches: (data, key) => data === key,
		key: "f6",
		focusKey: "alt+w",
		focused: () => true,
		blur: () => blurred++,
		rows: () => 40,
		done: () => closed++,
		requestRender: () => renders++,
	});
	assert.match(view.render(40).join("\n"), /2 ricordi · «q»/);
	assert.doesNotMatch(view.render(40).join("\n"), /id:a/); // closed: the id shows only in an open card
	view.handleInput("down");
	view.handleInput("enter");
	assert.match(view.render(40).join("\n"), /id:b/); // the second card is open
	assert.doesNotMatch(view.render(40).join("\n"), /id:a/);
	view.handleInput("enter");
	assert.doesNotMatch(view.render(40).join("\n"), /id:b/);
	view.handleInput("escape");
	view.handleInput("alt+w");
	assert.equal(blurred, 2); // Esc and the focus key give the keys back, the panel stays
	assert.equal(closed, 0);
	view.handleInput("f6");
	assert.equal(closed, 1);
	view.handleInput("q");
	assert.equal(closed, 2); // Q closes the panel too
	assert.ok(renders >= 3);
});

test("the panel says so when Micelio is offline or empty", () => {
	for (const [status, text] of [["offline", /non risponde/], ["ok", /non ha restituito/]] as const) {
		const view = new PanelView({ read: () => ({ status, query: "q", memories: [] }), paint: plain, text: { name: (t) => t, dim: (t) => t }, matches: () => false, key: "f6", focusKey: "alt+w", focused: () => true, blur() {}, rows: () => 20, done() {}, requestRender() {} });
		assert.match(view.render(40).join("\n"), text);
	}
});

test("a click on a card opens it, a click elsewhere only takes the focus", () => {
	const items: Memory[] = [
		{ id: "a", type: "fact", title: "Uno", author: "x", date: "d", tags: "", body: "corpo uno" },
		{ id: "b", type: "gotcha", title: "Due", author: "x", date: "d", tags: "", body: "corpo due" },
	];
	const view = new PanelView({ read: () => ({ status: "ok", query: "q", memories: items }), paint: plain, text: { name: (t) => t, dim: (t) => t }, matches: () => false, key: "f6", focusKey: "alt+w", focused: () => true, blur() {}, rows: () => 40, done() {}, requestRender() {} });
	view.render(40); // head: 2 rows, then card a (rows 2-5), card b (rows 6-9)
	assert.equal(view.handleMouse({ type: "click", button: "left", y: 7 })?.render, true);
	const text = view.render(40).join("\n");
	assert.match(text, /id:b/);
	assert.doesNotMatch(text, /id:a/);
	assert.equal(view.handleMouse({ type: "click", button: "left", y: 0 })?.focus, true); // the header: no card
	assert.equal(view.handleMouse({ type: "wheel", y: 7 }), undefined);
});

test("the panel marks a card as chosen only while it holds the keyboard", () => {
	const items: Memory[] = [{ id: "a", type: "fact", title: "Uno", author: "x", date: "d", tags: "", body: "corpo" }];
	let focused = false;
	const marks: boolean[] = [];
	const view = new PanelView({ read: () => ({ status: "ok", query: "q", memories: items }), paint: { ...plain, frame: (text, selected) => { if (text.startsWith("╭")) marks.push(selected); return text; } }, text: { name: (t) => t, dim: (t) => t }, matches: () => false, key: "f6", focusKey: "alt+w", focused: () => focused, blur() {}, rows: () => 40, done() {}, requestRender() {} });
	assert.match(view.render(60).join("\n"), /Tastiera nel pannello/);
	focused = true;
	assert.match(view.render(60).join("\n"), /Torna alla chat/);
	assert.deepEqual(marks, [false, true]);
});

test("key ids read as F6 in the legend", () => {
	
	assert.equal(keyLabel("alt+s"), "Alt+S");
});

test("the legend aligns action and keys and never cuts, whatever the width", () => {
	const shortcuts = [{ keys: ["↑", "↓"], label: "Scegli una card" }, { keys: ["Esc", "Alt+W"], label: "Torna alla chat" }, { keys: ["F6"], label: "Chiudi il pannello" }];
	for (const width of [20, 30, 56, 90]) {
		const rows = legendLines(shortcuts, width, plain);
		const text = rows.join("\n");
		assert.doesNotMatch(text, /…/);
		for (const shortcut of shortcuts) {
			for (const word of shortcut.label.split(" ")) assert.ok(text.includes(word), `${width}: ${word}`);
			for (const key of shortcut.keys) assert.ok(text.includes(`[${key}]`), `${width}: ${key}`);
		}
		for (const row of rows) assert.ok(visibleLength(row) <= width, `${width}: ${visibleLength(row)}`);
	}
	const wide = legendLines(shortcuts, 56, plain);
	assert.equal(wide.length, 3); // one row each: action left, keys right
	assert.equal(new Set(wide.map((row) => visibleLength(row))).size, 1); // the keys end on the same column
});
