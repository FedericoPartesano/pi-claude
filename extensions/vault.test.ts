import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFakeEmbedder } from "../pi-memory/src/embed.ts";
import vault, { estimateText, formatHits, hooks, promptLine, resolveSource } from "./vault.ts";

function setup(notes: Record<string, string>, confirm = true) {
	const root = mkdtempSync(join(tmpdir(), "vaultext-"));
	mkdirSync(join(root, ".obsidian"));
	for (const [path, body] of Object.entries(notes)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), body);
	}
	process.env.PI_VAULT = root;
	process.env.HOME = mkdtempSync(join(tmpdir(), "home-"));
	hooks.embedder = Object.assign(createFakeEmbedder(), { ready: true, start: async () => true });
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<unknown>>();
	let active = ["read", "bash"];
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; isError?: boolean }> }>();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const messages: string[] = [];
	const status: (string | undefined)[] = [];
	const confirms: string[] = [];
	const widgets: (string[] | undefined)[] = [];
	const ctx = {
		cwd: root,
		hasUI: true,
		ui: {
			setWidget: (key: string, lines?: string[]) => void widgets.push(lines),
			onTerminalInput: () => () => {},
			setStatus: (_key: string, value?: string) => void status.push(value),
			confirm: async (_title: string, body: string) => (confirms.push(body), confirm),
			notify: () => {},
			select: async () => undefined,
			input: async () => undefined,
		},
	};
	vault({
		registerCommand: (name: string, command: { handler: never }) => void commands.set(name, command.handler),
		registerTool: (tool: { name: string; execute: never }) => void tools.set(tool.name, tool),
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => void (active = names),
		on: (name: string, handler: never) => void handlers.set(name, handler),
		sendMessage: (message: { content: string }) => void messages.push(message.content),
	} as never);
	return { root, ctx, commands, tools, handlers, messages, status, confirms, widgets, active: () => active };
}

const NOTES = { "idee.md": "# Cache\nUsiamo sqlite per la cache locale.\n\n# Rete\nIl proxy aziendale blocca il traffico.", "CLAUDE.md": "# Regole\nUsa tab per indentare." };

test("session_start: conta le sezioni da indicizzare nel footer, senza indicizzare niente", async () => {
	const f = setup(NOTES, false);
	await f.handlers.get("session_start")!({}, f.ctx);
	await hooks.startup;
	assert.match(f.status.at(-1)!, /^Vault: \d+ sezioni da indicizzare/);
	assert.match(f.confirms[0], /3 sezioni/);
});

test("avvio: conferma, poi loader con barra e file in lettura, e alla fine loader tolto", async () => {
	const f = setup(NOTES);
	await f.handlers.get("session_start")!({}, f.ctx);
	await hooks.startup;
	assert.equal(f.confirms.length, 1);
	assert.match(f.messages.at(-1)!, /Indice aggiornato/);
	const shown = f.widgets.filter(Boolean).map((lines) => lines!.join("\n")).join("\n");
	assert.match(shown, /Analizzo CLAUDE\.md e vault/);
	assert.match(shown, /█/);
	assert.match(shown, /Sto leggendo: (idee|CLAUDE)\.md/);
	assert.equal(f.widgets.at(-1), undefined);
	f.widgets.length = 0;
	await f.handlers.get("session_start")!({}, f.ctx);
	await hooks.startup;
	assert.equal(f.confirms.length, 1, "indice già pronto: non richiede conferma");
});

test("senza conferma niente viene indicizzato; con conferma sì, mostrando prima la stima", async () => {
	const no = setup(NOTES, false);
	await no.commands.get("vault")!("index", no.ctx);
	assert.match(no.confirms[0], /sezioni, \d+ da calcolare/);
	assert.match(no.messages.at(-1)!, /annullata/);
	assert.equal((await no.tools.get("vault_search")!.execute("1", { query: "sqlite" }, undefined, undefined, no.ctx)).isError, true);

	const yes = setup(NOTES);
	await yes.commands.get("vault")!("index", yes.ctx);
	assert.match(yes.messages.at(-1)!, /Indice aggiornato .* Token usati: 0/);
	assert.equal(readFileSync(join(yes.root, ".pi/vault/.gitignore"), "utf8"), "*\n");
	await yes.commands.get("vault")!("index", yes.ctx);
	assert.match(yes.messages.at(-1)!, /^Indicizzazione\nIndice aggiornato: 3 sezioni/);
	assert.equal(yes.confirms.length, 1, "la seconda volta non chiede: non c'è niente da fare");
	assert.equal(yes.status.at(-1), undefined);
});

test("vault_search e vault_read: risultati reali, percorso fuori dal vault rifiutato", async () => {
	const f = setup(NOTES);
	await f.commands.get("vault")!("index", f.ctx);
	const search = await f.tools.get("vault_search")!.execute("1", { query: "sqlite cache locale" }, undefined, undefined, f.ctx);
	assert.match(search.content[0].text, /^idee\.md › Cache \(riga 1\)/);
	const section = await f.tools.get("vault_read")!.execute("1", { path: "idee.md", section: "Rete" }, undefined, undefined, f.ctx);
	assert.match(section.content[0].text, /proxy aziendale/);
	assert.doesNotMatch(section.content[0].text, /sqlite/);
	const outside = await f.tools.get("vault_read")!.execute("1", { path: "../../etc/passwd" }, undefined, undefined, f.ctx);
	assert.equal(outside.isError, true);
	const claude = await f.tools.get("vault_read")!.execute("1", { path: "CLAUDE.md" }, undefined, undefined, f.ctx);
	assert.match(claude.content[0].text, /tab/);
});

test("prompt: nessuna riga prima dell'indice; poi una riga stabile e corta, mai duplicata", async () => {
	const f = setup(NOTES);
	const before = f.handlers.get("before_agent_start")!;
	assert.equal(before({ systemPrompt: "base" }, f.ctx), undefined);
	await f.commands.get("vault")!("index", f.ctx);
	const first = before({ systemPrompt: "base" }, f.ctx) as { systemPrompt: string };
	assert.equal(first.systemPrompt, `base\n\n${promptLine(2, f.root.split("/").pop()!)}`);
	assert.deepEqual(first, before({ systemPrompt: "base" }, f.ctx), "stesso testo a parità di stato");
	assert.equal(before({ systemPrompt: first.systemPrompt }, f.ctx), undefined);
	assert.ok(promptLine(200, "vault").length / 3.5 < 40, "sotto ~40 token");
});

test("formatHits, estimateText, resolveSource", () => {
	assert.equal(formatHits([]), "Nessun risultato pertinente.");
	assert.match(formatHits([{ path: "a.md", section: "S", line: 3, text: "a.md › S\ncorpo lungo", score: 1, tags: ["x"] }]), /^a\.md › S \(riga 3\) #x\n {2}corpo lungo$/);
	assert.match(estimateText({ chunks: 300, pending: 300, removed: 0 }), /300 da calcolare.*circa 60 s/);
	assert.equal(resolveSource("/tmp", "x.md", "/non/esiste"), undefined);
});

test("vault_search avvisa se le note sono cambiate dopo l'indice; vault_read mostra i collegamenti", async () => {
	const f = setup({ ...NOTES, "rete.md": "# Proxy\nIl proxy blocca. Vedi [[idee]]." });
	await f.commands.get("vault")!("index", f.ctx);
	const run = (query: string, extra = {}) => f.tools.get("vault_search")!.execute("1", { query, ...extra }, undefined, undefined, f.ctx);
	assert.doesNotMatch((await run("sqlite cache")).content[0].text, /Attenzione/);
	writeFileSync(join(f.root, "idee.md"), "# Cache\nUsiamo redis adesso, tutta un'altra storia.\n");
	assert.match((await run("sqlite cache")).content[0].text, /Attenzione: \d+ sezioni modificate/);
	assert.match((await run("proxy", { folder: "nessuna" })).content[0].text, /Nessun risultato/);
	const read = await f.tools.get("vault_read")!.execute("1", { path: "idee.md" }, undefined, undefined, f.ctx);
	assert.match(read.content[0].text, /Collegata da: rete\.md/);
});

test("i tool costano token a ogni richiesta: attivi solo con un indice, tolti se sparisce", async () => {
	const f = setup(NOTES, false);
	await f.handlers.get("session_start")!({}, f.ctx);
	await hooks.startup;
	assert.deepEqual(f.active(), ["read", "bash"], "senza indice niente schema vault_*");
	const yes = setup(NOTES);
	await yes.handlers.get("session_start")!({}, yes.ctx);
	await hooks.startup;
	assert.deepEqual(yes.active(), ["read", "bash", "vault_search", "vault_read"]);
});
