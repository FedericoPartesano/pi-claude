import assert from "node:assert/strict";
import test from "node:test";
import archivio, { archivedEntries, autoRecall, chunkArchive, openEntry, renderHits, search } from "./archivio.ts";

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
