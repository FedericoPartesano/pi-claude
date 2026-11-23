process.env.PI_ARCHIVE_SEM = "0"; // no model worker in unit tests
process.env.PI_ARCHIVE_TOOL = "1"; // the tool is opt-in; its tests need it on
import assert from "node:assert/strict";
import test from "node:test";
import archivio, { constRecall, factRecall, keyRecall, archiveOverview, archivedEntries, rankSemantic, autoRecall, chunkArchive, openEntry, renderHits, search, semanticRecall } from "./archivio.ts";

const msg = (id: string, role: string, text: string, toolName?: string) => ({ type: "message", id, message: { role, toolName, content: [{ type: "text", text }] } });
const branch = [
	msg("a1", "user", "Imposta MCP_TOOL_TIMEOUT a 120000 in provider.ts"),
	msg("a2", "toolResult", "provider.ts:412 const MCP_TOOL_TIMEOUT = 120000", "bash"),
	msg("a3", "assistant", "Fatto, il timeout vale 120000 ms."),
	msg("b1", "user", "ora lavoriamo sul footer"),
	{ type: "compaction", id: "c1", firstKeptEntryId: "b1", summary: "..." },
	msg("b2", "assistant", "footer ok"),
];

test("the archive is what the last compaction left out, not the kept tail", () => {
	assert.deepEqual(archivedEntries(branch).map((entry) => entry.id), ["a1", "a2", "a3"]);
	assert.deepEqual(archivedEntries(branch.slice(0, 3)), []);
});

test("search finds an exact detail from before the compaction", () => {
	const hits = search(chunkArchive(archivedEntries(branch)), "MCP_TOOL_TIMEOUT valore", 2);
	assert.equal(hits[0].entryId.startsWith("a"), true);
	assert.match(renderHits(hits), /120000/);
	assert.match(renderHits(hits), /tool bash/);
});

test("no match and an empty archive give a clear answer", () => {
	assert.deepEqual(search(chunkArchive(archivedEntries(branch)), "zzzz"), []);
	assert.match(renderHits([]), /Nessun risultato/);
});

test("the tool stays off until something is compacted, then turns on", () => {
	const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
	let active = ["read"];
	const tools: string[] = [];
	archivio({
		on: (name: string, handler: never) => void (handlers[name] = handler),
		registerTool: (tool: { name: string }) => void tools.push(tool.name),
		registerCommand: () => {},
		getActiveTools: () => active,
		setActiveTools: (next: string[]) => void (active = next),
	} as never);
	handlers.session_start({}, { sessionManager: { getBranch: () => branch.slice(0, 3) } });
	assert.deepEqual([tools, active], [[], ["read"]]);
	handlers.session_compact({}, { sessionManager: { getBranch: () => branch } });
	assert.deepEqual([tools, active], [["richiama"], ["read", "richiama"]]);
});

test("auto recall adds excerpts only when the request shares several terms; an entry opens whole by id", () => {
	const chunks = chunkArchive(archivedEntries(branch));
	assert.match(autoRecall(chunks, "imposta MCP_TOOL_TIMEOUT 120000 provider.ts timeout vale"), /120000/);
	assert.equal(autoRecall(chunks, "ora sistemiamo il footer"), "");
	assert.equal(autoRecall(chunks, "ok"), "");
	assert.match(openEntry(archivedEntries(branch), "#a2"), /provider\.ts:412/);
	assert.match(openEntry([], "zz"), /non trovata/);
});

test("chunkArchive: a tool result carries the arguments of the call that produced it, so it can be found by file name", () => {
	const entries = [
		{ type: "message", id: "a", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "cat /w/logs/b04.txt" } }] } },
		{ type: "message", id: "b", message: { role: "toolResult", toolName: "bash", toolCallId: "c1", content: [{ type: "text", text: "L1 = AAAA\nL20 = 3F8FE9" }] } },
	];
	const hits = search(chunkArchive(entries), "b04 L20", 2);
	assert.equal(hits[0].entryId, "b");
	assert.match(hits[0].text, /b04\.txt.*L20 = 3F8FE9/s);
});

test("autoRecall: an old user message that is the same command as the prompt is not injected", () => {
	const chunks = chunkArchive([
		{ type: "message", id: "u1", message: { role: "user", content: "Leggi con il tool read il file /w/extensions/graph/graphify.ts e rispondi solo letto" } },
		{ type: "message", id: "u2", message: { role: "user", content: "Decisione: la porta del server dei bug resta 7421 e il token sta in bug-token.txt per ogni ambiente di prova" } },
	]);
	assert.equal(autoRecall(chunks, "Leggi con il tool read il file /w/pi-ui/src/render.ts e rispondi solo letto"), "");
	assert.match(autoRecall(chunks, "quale porta del server dei bug e quale file del token avevamo deciso per le prove"), /7421/);
});

test("semanticRecall: only a chunk that stands out from the archive is injected; a repeated command is not", () => {
	const chunks = Array.from({ length: 40 }, (_, i) => ({ entryId: `e${i}`, role: "tool", label: "tool read", text: `filler ${i}` }));
	chunks[7] = { entryId: "e7", role: "assistant", label: "assistant", text: "la porta di staging è 33077" };
	const vectors = new Map<string, Float32Array>();
	chunks.forEach((chunk, i) => { const v = new Float32Array(8); v[i % 7 === 0 ? 1 : 2] = 0.6; v[3] = 0.6; vectors.set(chunk.text, v); });
	const target = new Float32Array(8); target[0] = 1;
	vectors.set(chunks[7].text, target);
	const query = new Float32Array(8); query[0] = 1;
	assert.match(semanticRecall(chunks, vectors, query, "quale porta usavamo", 3.5), /33077/);
	assert.equal(semanticRecall(chunks, vectors, Float32Array.from([0, 0, 1, 0, 0, 0, 0, 0]), "altro", 3.5), "");
});

test("semanticRecall: a chunk already injected is not sent again", () => {
	const chunks = Array.from({ length: 40 }, (_, i) => ({ entryId: `e${i}`, role: "tool", label: "tool read", text: `filler ${i}` }));
	chunks[7] = { entryId: "e7", role: "assistant", label: "assistant", text: "la porta di staging è 33077" };
	const vectors = new Map<string, Float32Array>();
	chunks.forEach((chunk) => vectors.set(chunk.text, Float32Array.from([0, 0.6, 0.6, 0, 0, 0, 0, 0])));
	vectors.set(chunks[7].text, Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]));
	const query = Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
	const used = new Set<string>();
	assert.match(semanticRecall(chunks, vectors, query, "quale porta", 3.5, 1500, used, (hit) => used.add(hit.entryId)), /33077/);
	assert.equal(semanticRecall(chunks, vectors, query, "quale porta", 3.5, 1500, used), "");
});

test("rankSemantic gives every chunk a z-score and ranks the closest first", () => {
	const chunks = Array.from({ length: 30 }, (_, i) => ({ entryId: `e${i}`, role: "tool", label: "tool read", text: `filler ${i}` }));
	const vectors = new Map<string, Float32Array>();
	chunks.forEach((chunk) => vectors.set(chunk.text, Float32Array.from([0, 0.6, 0.6, 0])));
	vectors.set(chunks[3].text, Float32Array.from([1, 0, 0, 0]));
	const ranked = rankSemantic(chunks, vectors, Float32Array.from([1, 0, 0, 0]), 5);
	assert.equal(ranked.length, 5);
	assert.equal(ranked[0].entryId, "e3");
	assert.ok((ranked[0].z ?? 0) > 4);
});

test("archiveOverview lists archived entries and the recalls with their hits", () => {
	const full = [
		...branch,
		{ type: "custom_message", id: "r1", customType: "archive-recall", content: "Dalla storia compattata:\n[#a2 bash] x", details: { prompt: "quanto vale il timeout?", method: "semantic", hits: [{ id: "a2", label: "tool bash", z: 5.1 }] }, timestamp: "2026-11-05T10:00:00Z" },
	];
	const overview = archiveOverview(full as never);
	assert.equal(overview.compactions, 1);
	assert.equal(overview.entries.length, 3);
	assert.equal(overview.entries[1].label, "tool bash");
	assert.equal(overview.entries[1].injected, 1);
	assert.equal(overview.injections.length, 1);
	assert.equal(overview.injections[0].hits[0].z, 5.1);
});

test("archiveText summarises entries and injections for clients without the full-screen view", async () => {
	const { archiveText } = await import("./archivio.ts");
	const text = archiveText({
		entries: [{ id: "abcdef123456", role: "user", label: "user", chars: 40, preview: "ciao mondo", injected: 2 }],
		injections: [{ at: "", prompt: "dove sta il file?", method: "semantic", hits: [{ id: "abcdef123456", label: "x" }], text: "" }],
		compactions: 1,
	});
	assert.match(text, /1 voci, 1 compattazioni, 1 iniezioni/);
	assert.match(text, /sem #abcdef123456 ← dove sta il file\?/);
	assert.match(text, /#abcdef12 user 40c ×2  ciao mondo/);
});

test("billion-context folds count as archive: entries covered by an active compress block are searchable", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { foldedIds } = await import("./archivio.ts");
	const live = [msg("a1", "user", "Imposta MCP_TOOL_TIMEOUT a 120000"), msg("a2", "toolResult", "provider.ts:412 const MCP_TOOL_TIMEOUT = 120000", "bash"), msg("a3", "assistant", "ok"), msg("b1", "user", "footer")];
	const file = join(mkdtempSync(join(tmpdir(), "arch-")), "s.jsonl");
	assert.equal(foldedIds(file).size, 0, "no sidecar, nothing folded");
	writeFileSync(`${file}.acp.json`, JSON.stringify({ blocks: [{ blockId: "b1", active: true, effectiveMessageIds: ["a1", "a2"] }, { blockId: "b0", active: false, effectiveMessageIds: ["a3"] }] }));
	const folded = foldedIds(file);
	assert.deepEqual([...folded].sort(), ["a1", "a2"]);
	assert.deepEqual(archivedEntries(live, folded).map((entry) => entry.id), ["a1", "a2"]);
	assert.ok(search(chunkArchive(archivedEntries(live, folded)), "provider.ts MCP_TOOL_TIMEOUT", 2).some((hit) => hit.entryId === "a2"));
	// Both a Pi compaction and folds: union, oldest first, no duplicates.
	assert.deepEqual(archivedEntries(branch, new Set(["a1", "b2"])).map((entry) => entry.id), ["a1", "a2", "a3", "b2"]);
});

test("autoRecall: a prompt naming several identifiers held by different entries gets a short excerpt for each", () => {
	const filler = (n: number) => Array.from({ length: n }, (_, i) => `riga ${i} di codice qualunque`).join("\n");
	const arch = [
		msg("f1", "toolResult", `${filler(30)}\nconst FADE_DAYS = 45;\n${filler(30)}`, "read"),
		msg("f2", "toolResult", `${filler(30)}\nconst REMIND_AFTER = 3;\n${filler(30)}`, "read"),
		msg("f3", "toolResult", `${filler(30)}\nexport const QUADRO_CHARS = 2400;\n${filler(30)}`, "read"),
	];
	const text = autoRecall(chunkArchive(arch), "Senza rileggere i file dimmi i valori esatti di FADE_DAYS, REMIND_AFTER e QUADRO_CHARS", 1500);
	assert.match(text, /FADE_DAYS = 45/);
	assert.match(text, /REMIND_AFTER = 3/);
	assert.match(text, /QUADRO_CHARS = 2400/);
	assert.ok(text.length < 1500, `short excerpts, got ${text.length}`);
});

test("keyRecall: the definition line wins over a use; a shouted word in the prompt is not an identifier", () => {
	const arch = [
		msg("u1", "toolResult", "if (pending >= REMIND_AFTER) notify(); stale(FADE_DAYS)", "read"),
		msg("d1", "toolResult", "/** docs */ const FADE_DAYS = 60;\nconst REMIND_AFTER = 5;", "read"),
		msg("x1", "assistant", "le risposte sono pronte"),
	];
	const text = keyRecall(chunkArchive(arch), "Dimmi FADE_DAYS e REMIND_AFTER in un blocco RISPOSTE:");
	assert.match(text, /FADE_DAYS = 60/);
	assert.match(text, /REMIND_AFTER = 5/);
	assert.doesNotMatch(text, /#x1/);
	assert.equal(text.split("\n").length, 2, "one excerpt covers both keys");
	assert.match(keyRecall(chunkArchive(arch), "quanto vale FADE_DAYS?"), /FADE_DAYS = 60/, "one key: its definition");
	assert.equal(keyRecall(chunkArchive([arch[0]]), "quanto vale FADE_DAYS?"), "", "one key with no definition archived: nothing");
});

test("keyRecall: a long value is not cut, the window runs to the end of the statement", () => {
	const path = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
	const arch = [msg("p1", "toolResult", `${"x ".repeat(80)}const POWERSHELL = "${path}";\nconst OTHER_THING = 1;`, "read")];
	assert.ok(keyRecall(chunkArchive(arch), "quanto vale POWERSHELL e OTHER_THING?").includes(`"${path}"`));
});

test("keyRecall: a definition split across two chunks of the same entry comes back whole", () => {
	const path = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
	const body = `const POWERSHELL = "${path}";\nconst OTHER_THING = 1;`;
	const chunks = chunkArchive([msg("p1", "toolResult", body, "read")]);
	const split = [{ ...chunks[0], text: body.slice(0, 40) }, { ...chunks[0], text: body.slice(40) }];
	assert.ok(keyRecall(split, "quanto vale POWERSHELL e OTHER_THING?").includes(`"${path}"`));
});

test("factRecall: a fact the user stated, and the answer to an old request, come back for a question that names them", () => {
	const chunks = chunkArchive([
		msg("u1", "user", "Annota per dopo: il ticket è PIC-2291, il revisore è Giulia Ferraris. Rispondi solo: ok."),
		msg("a1", "assistant", "ok"),
		msg("u2", "user", "Leggi per intero con il tool read /x/panel.ts. Poi scrivi una sola riga di sintesi."),
		msg("a2", "assistant", "panel.ts: pannello laterale."),
		msg("u3", "user", "Conta con bash il totale delle righe di extensions/*.ts e scrivi solo il numero."),
		{ type: "message", id: "a3", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "wc -l" } }] } },
		{ type: "message", id: "t3", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "14403 total" }] } },
		msg("a4", "assistant", "14403"),
		msg("u4", "user", "Un'ultima nota: il nome in codice del rilascio è Aurora Boreale. Rispondi solo: ok."),
		msg("a5", "assistant", "ok"),
	]);
	const text = factRecall(chunks, "Rispondi con valori esatti: 1) il ticket 2) il revisore 3) il nome in codice del rilascio 4) il totale delle righe contato con bash");
	assert.match(text, /PIC-2291/);
	assert.match(text, /Giulia Ferraris/);
	assert.match(text, /Aurora Boreale/);
	assert.match(text, /14403/);
	assert.doesNotMatch(text, /panel\.ts/);
	// An ordinary prompt shares too few words with any stated fact: nothing is sent.
	assert.equal(factRecall(chunks, "Leggi per intero con il tool read /x/vault.ts. Poi scrivi una sola riga di sintesi."), "");
	assert.equal(factRecall(chunks, "Sistema il bug nel parser"), "");
});

test("factRecall: a later message that updates a stated fact comes back too, after the old one and marked as the latest", () => {
	const chunks = chunkArchive([
		msg("u1", "user", "Altra nota: il budget approvato è 18.400 euro e il server di staging ascolta sulla porta 8817. Rispondi solo: ok."),
		msg("a1", "assistant", "ok"),
		msg("u2", "user", "Decisione presa con Marta: niente Redis. La scadenza è martedì 15 dicembre. Rispondi solo: ok."),
		msg("a2", "assistant", "ok"),
		msg("u3", "user", "Leggi per intero con il tool read src/staging/port.ts. Poi scrivi una sola riga di sintesi."),
		msg("a3", "assistant", "port.ts: apre la porta di staging."),
		msg("u4", "user", "Aggiornamento: la porta di staging è cambiata, ora è 9124. E la scadenza è slittata a giovedì 7 gennaio. Rispondi solo: ok."),
		msg("a4", "assistant", "ok"),
	]);
	const port = factRecall(chunks, "Senza rileggere file, rispondi in un blocco RISPOSTE con valori esatti; se un valore non ti è mai stato dato scrivi non detto: 1) il ticket 2) la porta attuale del server di staging 3) CUSTOMS_HOLD_HOURS 4) il nome in codice");
	assert.match(port, /8817[\s\S]*più recente[\s\S]*9124/);
	assert.doesNotMatch(port, /port\.ts/);
	assert.match(factRecall(chunks, "Senza rileggere file, rispondi in un blocco RISPOSTE con valori esatti; se un valore non ti è mai stato dato scrivi non detto: 1) il cliente 2) cosa abbiamo deciso con Marta 3) la scadenza attuale 4) FLEET_IDLE_ALERT_MIN"), /15 dicembre[\s\S]*più recente[\s\S]*7 gennaio/);
	// The old message was already sent for another part of the prompt: the update still comes back.
	// No update cue: a later message on the same subject is not an update.
	assert.doesNotMatch(factRecall(chunks, "Senza rileggere file, rispondi in un blocco RISPOSTE con valori esatti; se un valore non ti è mai stato dato scrivi non detto: 1) il ticket 2) il budget approvato 3) LABEL_DPI 4) il nome in codice"), /più recente/);
});

// Long chat: after compress the reads of vault.ts and panel.ts survived only as one-line summaries ("e5 embeddings"),
// and the quiz asked for them by description, with no identifier: "non so" twice, while off still had them live.
test("constRecall: a question naming a file read earlier, without identifiers, brings back that file's constants", () => {
	const read = (id: string, path: string, text: string) => [
		{ type: "message", id: `c${id}`, message: { role: "assistant", content: [{ type: "toolCall", id: `k${id}`, name: "read", arguments: { path } }] } },
		{ type: "message", id: `t${id}`, message: { role: "toolResult", toolCallId: `k${id}`, toolName: "read", content: [{ type: "text", text }] } },
	];
	const chunks = chunkArchive([
		...read("1", "/r/extensions/vault.ts", `import x from "y";\n${"// filler\n".repeat(120)}const MODEL_NAME = "Xenova/multilingual-e5-small";\nconst helper = 1;\nexport const PROMPT_MARKER = "Vault:";`),
		...read("2", "/r/pi-ui/src/panel.ts", "export const PANEL_KEY = \"alt+p\";\nexport const PANEL_WIDTH = 40;\nfunction f() {\n\tconst INNER = 2;\n}"),
		...read("3", "/r/extensions/loop.ts", "const WHEN_TIMEOUT_MS = 5 * 60_000;"),
	]);
	const text = constRecall(chunks, "Rispondi: 1) il modello di embedding usato dall'estensione vault 2) la larghezza del pannello di pi-ui 3) WHEN_TIMEOUT_MS in loop.ts");
	assert.match(text, /vault\.ts: const MODEL_NAME = "Xenova\/multilingual-e5-small";/);
	assert.match(text, /PROMPT_MARKER/);
	assert.match(text, /panel\.ts: export const PANEL_WIDTH = 40;/);
	// Only top-level constants; a part with an identifier is keyRecall's job.
	assert.doesNotMatch(text, /INNER|helper|WHEN_TIMEOUT_MS/);
	assert.equal(constRecall(chunks, "Sistema il bug nel parser"), "");
	// The reads are only chunked when the prompt describes something.
	let built = 0;
	assert.equal(constRecall(() => (built++, chunks), "1) PIC_TICKET 2) /a/b.ts"), "");
	assert.equal(built, 0);
	assert.match(constRecall(() => (built++, chunks), "la larghezza del pannello di pi-ui"), /PANEL_WIDTH = 40/);
	assert.equal(built, 1);
	assert.equal(constRecall(chunks, "Leggi per intero con il tool read /r/extensions/vault.ts e riassumi"), "");
});
