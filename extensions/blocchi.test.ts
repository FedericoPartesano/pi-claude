import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import blocchi, { blockMessages, blockTree, startServer } from "./blocchi.ts";

const user = (id: string, text: string) => ({ type: "message", id, message: { role: "user", content: [{ type: "text", text }] } });
const call = (id: string, callId: string, path: string) => ({ type: "message", id, message: { role: "assistant", content: [{ type: "text", text: "Leggo." }, { type: "toolCall", id: callId, name: "read", arguments: { path } }] } });
const result = (id: string, callId: string, text: string) => ({ type: "message", id, message: { role: "toolResult", toolCallId: callId, toolName: "read", content: [{ type: "text", text }] } });
const entries = [
	{ type: "session", id: "s0" },
	user("u1", "Leggi log/0001.md"),
	call("a1", "t1", "log/0001.md"),
	result("r1", "t1", "porta 9124"),
	user("u2", "Leggi log/0002.md"),
	call("a2", "t2", "log/0002.md"),
	result("r2", "t2", "scadenza 7 gennaio"),
	user("u3", "Domanda finale"),
];
const block = (blockId: string, ids: string[], extra: Record<string, unknown> = {}) => ({ blockId, topic: `Topic ${blockId}`, summary: `Summary ${blockId}`, tier: "1", active: true, compressedTokens: 1200, directBlockIds: [], directMessageIds: ids, effectiveMessageIds: ids, ...extra });
const state = {
	blocks: [
		block("b1", ["u1", "a1", "a1#t1", "r1"], { active: false }),
		block("b2", ["u2", "a2", "r2"], { active: false }),
		block("b3", ["u1", "a1", "a1#t1", "r1", "u2", "a2", "r2"], { directBlockIds: ["b1", "b2"], directMessageIds: [] }),
	],
};

test("blockTree: top-level blocks with their children, and the messages still live", () => {
	const tree = blockTree(state, entries);
	assert.deepEqual(tree.blocks.map((b) => b.blockId), ["b3"]);
	assert.deepEqual(tree.blocks[0].children.map((b) => b.blockId), ["b1", "b2"]);
	assert.equal(tree.blocks[0].messages, 6);
	assert.equal(tree.blocks[0].summary, "Summary b3");
	assert.equal(tree.live, 1);
	assert.equal(tree.active, 1);
	assert.equal(tree.compressedTokens, 1200);
});

test("blockMessages: the original messages of a block, in session order, tool call refs merged into their entry", () => {
	const messages = blockMessages(state, entries, "b1");
	assert.deepEqual(messages.map((m) => m.id), ["u1", "a1", "r1"]);
	assert.equal(messages[0].role, "user");
	assert.deepEqual(messages[1].parts, [{ kind: "text", text: "Leggo." }, { kind: "tool", text: 'read {"path":"log/0001.md"}' }]);
	assert.deepEqual(messages[2].parts, [{ kind: "result", text: "porta 9124" }]);
	assert.equal(messages[2].label, "read");
	assert.equal(blockMessages(state, entries, "b9"), undefined);
});

test("server: page, state and block behind a token, nothing without it, live updates on change", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "blocchi-"));
	const file = join(dir, "s.jsonl");
	writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
	writeFileSync(`${file}.acp.json`, JSON.stringify(state));
	const server = await startServer(() => file);
	t.after(() => server.close());
	const base = server.url.replace(/\/\?.*$/, "");
	const token = new URL(server.url).searchParams.get("t");
	assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{32}$/);
	assert.equal((await fetch(`${base}/api/state`)).status, 403);
	const rebound = await new Promise<number>((resolve, reject) => {
		const u = new URL(`${base}/api/state?t=${token}`);
		request({ host: "127.0.0.1", port: u.port, path: u.pathname + u.search, headers: { host: "evil.example" } }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		}).on("error", reject).end();
	});
	assert.equal(rebound, 403);
	const page = await (await fetch(server.url)).text();
	assert.match(page, /<title>Blocchi della memoria<\/title>/);
	const got = await (await fetch(`${base}/api/state?t=${token}`)).json();
	assert.equal(got.blocks[0].blockId, "b3");
	assert.equal(got.file, file);
	const opened = await (await fetch(`${base}/api/block/b2?t=${token}`)).json();
	assert.deepEqual(opened.messages.map((m: { id: string }) => m.id), ["u2", "a2", "r2"]);
	assert.equal((await fetch(`${base}/api/block/b9?t=${token}`)).status, 404);
	// A change to the sidecar reaches an open event stream.
	const controller = new AbortController();
	const events = await fetch(`${base}/events?t=${token}`, { signal: controller.signal });
	const reader = (events.body as ReadableStream<Uint8Array>).getReader();
	await reader.read();
	setTimeout(() => writeFileSync(`${file}.acp.json`, JSON.stringify({ blocks: [] })), 50);
	const deadline = Date.now() + 3000;
	let text = "";
	while (!text.includes("change") && Date.now() < deadline) text += new TextDecoder().decode((await reader.read()).value);
	controller.abort();
	assert.match(text, /change/);
});

test("/blocchi starts one server for the session and closes it on shutdown", async () => {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
	process.env.PI_BLOCCHI_NO_OPEN = "1";
	blocchi({ on: (name: string, handler: never) => void (handlers[name] = handler), registerCommand: (name: string, spec: never) => void (commands[name] = spec) } as never);
	const notes: string[] = [];
	const ctx = { sessionManager: { getSessionFile: () => undefined }, ui: { notify: (text: string) => notes.push(text) } };
	await commands.blocchi.handler("", ctx);
	assert.match(notes[0], /Sessione non salvata/);
	const dir = mkdtempSync(join(tmpdir(), "blocchi-"));
	const file = join(dir, "s.jsonl");
	writeFileSync(file, "");
	const ctx2 = { sessionManager: { getSessionFile: () => file }, ui: { notify: (text: string) => notes.push(text) } };
	await commands.blocchi.handler("", ctx2);
	await commands.blocchi.handler("", ctx2);
	const urls = notes.slice(1).map((n) => n.match(/http:\S+/)?.[0]);
	assert.equal(urls.length, 2);
	assert.equal(urls[0], urls[1]);
	assert.equal((await fetch(urls[0] as string)).status, 200);
	await handlers.session_shutdown({}, ctx2);
	await assert.rejects(fetch(urls[0] as string));
});

test("panel status: billion-context on with its blocks, or plainly off with the fix", async () => {
	const handlers: Record<string, (event: unknown, ctx: unknown) => Promise<void> | void> = {};
	let tools = [{ name: "read" }, { name: "compress" }];
	blocchi({ on: (name: string, handler: never) => void (handlers[name] = handler), registerCommand: () => {}, getAllTools: () => tools } as never);
	const dir = mkdtempSync(join(tmpdir(), "blocchi-"));
	const file = join(dir, "s.jsonl");
	writeFileSync(file, "");
	const status = new Map<string, string | undefined>();
	const ctx = { sessionManager: { getSessionFile: () => file }, ui: { setStatus: (k: string, v?: string) => status.set(k, v), notify: () => {} } };
	await handlers.session_start({}, ctx);
	assert.equal(status.get("billion-context"), "attivo · nessun blocco");
	writeFileSync(`${file}.acp.json`, JSON.stringify({ blocks: [block("b1", ["u1"], { compressedTokens: 42_000 }), block("b2", ["u2"], { active: false })] }));
	await handlers.agent_end({}, ctx);
	assert.equal(status.get("billion-context"), "attivo · 1 blocco · 42k compressi");
	tools = [{ name: "read" }];
	await handlers.session_start({}, ctx);
	assert.equal(status.get("billion-context"), "spento · rilancia install.sh");
});
