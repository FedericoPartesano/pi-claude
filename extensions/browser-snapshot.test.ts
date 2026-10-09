import { test } from "node:test";
import assert from "node:assert/strict";
import { compactSnapshot, diffSnapshot, nameOf, RefTable, type AXNode } from "./browser/snapshot.ts";

const node = (nodeId: string, role: string, name: string, childIds: string[] = [], extra: Partial<AXNode> = {}): AXNode => ({ nodeId, role: { value: role }, name: { value: name }, childIds, ...extra });

const page: AXNode[] = [
	node("1", "RootWebArea", "Negozio", ["2", "3", "6", "9"]),
	node("2", "heading", "Carrello", [], { backendDOMNodeId: 20, properties: [{ name: "level", value: { value: 1 } }] }),
	node("3", "generic", "", ["4", "5"]),
	node("4", "StaticText", "2 articoli nel carrello"),
	node("5", "button", "Svuota", [], { backendDOMNodeId: 50 }),
	node("6", "textbox", "Codice sconto", [], { backendDOMNodeId: 60, properties: [{ name: "focusable", value: { value: true } }] }),
	node("7", "none", "", [], { ignored: true }),
	node("9", "button", "Paga", [], { backendDOMNodeId: 90, properties: [{ name: "disabled", value: { value: true } }] }),
];

test("compact snapshot: interactive elements get refs, text and headings stay, wrappers and ignored nodes go", () => {
	const refs = new RefTable();
	const text = compactSnapshot(page, refs);
	assert.equal(text, ['- heading "Carrello" [level=1]', '- text "2 articoli nel carrello"', '- [e1] button "Svuota"', '- [e2] textbox "Codice sconto"', '- [e3] button "Paga" [disabled]'].join("\n"));
	assert.equal(refs.backendId("e1"), 50);
	assert.equal(refs.backendId("e9"), undefined);
});

test("refs are stable across snapshots for elements that survive", () => {
	const refs = new RefTable();
	compactSnapshot(page, refs);
	const after = [...page.slice(0, 4), node("5b", "button", "Annulla", [], { backendDOMNodeId: 55 }), ...page.slice(4)];
	after[2] = node("3", "generic", "", ["4", "5b", "5"]);
	const text = compactSnapshot(after, refs);
	assert.match(text, /\[e1\] button "Svuota"/);
	assert.match(text, /\[e4\] button "Annulla"/);
});

test("diff after an action: only what changed", () => {
	const before = '- heading "Carrello"\n- [e1] button "Svuota"\n- text "2 articoli nel carrello"';
	const after = '- heading "Carrello"\n- [e1] button "Svuota"\n- text "Carrello vuoto"';
	assert.equal(diffSnapshot(before, after), '- - text "2 articoli nel carrello"\n+ - text "Carrello vuoto"');
	assert.equal(diffSnapshot(before, before), "(nessun cambiamento)");
});

test("long pages are cut at a budget with a note", () => {
	const many: AXNode[] = [node("1", "RootWebArea", "x", Array.from({ length: 500 }, (_, i) => `t${i}`)), ...Array.from({ length: 500 }, (_, i) => node(`t${i}`, "link", `Articolo numero ${i}`, [], { backendDOMNodeId: 1000 + i }))];
	const text = compactSnapshot(many, new RefTable(), { maxChars: 2000 });
	assert.ok(text.length <= 2100);
	assert.match(text, /altri \d+ elementi/);
});

test("nameOf: the accessible name of a ref in the last snapshot, for the label shown on the page", () => {
	const snap = '- heading "Carrello"\n- [e1] button "Svuota"\n- [e12] button "Aggiungi «pro»" [disabled]\n- [e3] textbox';
	assert.equal(nameOf(snap, "e1"), "Svuota");
	assert.equal(nameOf(snap, "e12"), "Aggiungi «pro»");
	assert.equal(nameOf(snap, "e3"), "");
	assert.equal(nameOf(snap, "e9"), "");
});
