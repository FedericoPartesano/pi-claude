process.env.PI_ARCHIVE_SEM = "0"; // no model worker in unit tests
import assert from "node:assert/strict";
import test from "node:test";
import archivio, { archiveOverview, archivedEntries, rankSemantic, autoRecall, chunkArchive, openEntry, renderHits, search, semanticRecall } from "./archivio.ts";

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
