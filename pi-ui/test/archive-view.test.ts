import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type ArchiveOverview, ArchiveView } from "../src/archive-view.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_pi:c\x07/g, "");
const overview: ArchiveOverview = {
	compactions: 2,
	entries: [
		{ id: "a1b2c3d4e5", role: "toolResult", label: "tool read", chars: 1200, preview: "const MCP_TOOL_TIMEOUT = 120000", injected: 1 },
		{ id: "f6g7h8i9j0", role: "user", label: "user", chars: 40, preview: "ora il footer", injected: 0 },
	],
	injections: [{ at: "", prompt: "quanto vale il timeout?", method: "semantic", hits: [{ id: "a1b2c3d4", label: "tool read", z: 5.2 }], text: "Dalla storia compattata:\n[#a1b2c3d4 tool read] x" }],
};
const status = { chunks: 40, vectors: 40, semantic: true, threshold: 4.2 };

function setup() {
	let renders = 0;
	let closed = 0;
	const search = async () => ({ method: "semantic" as const, hits: [{ entryId: "a1b2c3d4e5", role: "tool", label: "tool read", text: "timeout 120000", score: 0.9, matched: 0.9, z: 5 }, { entryId: "f6g7h8i9j0", role: "user", label: "user", text: "footer", score: 0.7, matched: 0.7, z: 1 }] });
	const view = new ArchiveView(theme, overview, status, search, (id) => `voce intera ${id}`, () => closed++, () => renders++, () => 24);
	return { view, text: () => view.render(100).map(strip).join("\n"), closed: () => closed, renders: () => renders };
}

test("ogni riga ha la larghezza giusta", () => {
	const { view } = setup();
	for (const width of [60, 100, 140]) for (const line of view.render(width)) assert.equal(visibleWidth(line), width, strip(line));
});

test("la scheda iniezioni mostra prompt, voce e z; tab passa alle voci con il testo intero", () => {
	const { view, text } = setup();
	assert.match(text(), /sem .*#a1b2c3d4 z5\.2.*quanto vale il timeout/);
	view.handleInput("\t");
	assert.match(text(), /a1b2c3d4 .*tool read.*1200 car/);
	assert.match(text(), /voce intera a1b2c3d4e5/);
});

test("la prova scrive la domanda, invio calcola e segna in verde solo ciò che supera la soglia", async () => {
	const { view, text } = setup();
	view.handleInput("\t");
	view.handleInput("\t");
	for (const char of "timeout") view.handleInput(char);
	view.handleInput("\r");
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.match(text(), /z +5\.0 .*#a1b2c3d4/);
	assert.match(text(), /soglia z ≥ 4\.2/);
});

test("esc chiude", () => {
	const { view, closed } = setup();
	view.handleInput("\x1b");
	assert.equal(closed(), 1);
});
