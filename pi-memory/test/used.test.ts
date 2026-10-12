import { test } from "node:test";
import assert from "node:assert/strict";
import { loadedLines } from "../src/used.ts";

const memories = [{ id: "r5", type: "preferenza", text: "Niente commit   senza richiesta" }, { id: "r3", type: "fatto", text: "komorebi su Windows", linked: true }];

test("loadedLines: nothing loaded, nothing shown", () => {
	assert.deepEqual(loadedLines([], 80, false), []);
	assert.deepEqual(loadedLines([], 80, true), []);
});

test("loadedLines: one line, clipped to the width, with ids and flattened text", () => {
	assert.equal(loadedLines(memories, 200, false)[0], "◇ ricordi caricati: #r5 Niente commit senza richiesta · #r3 komorebi su Windows");
	const narrow = loadedLines(memories, 30, false);
	assert.equal(narrow.length, 1);
	assert.ok([...narrow[0]!].length <= 30 && narrow[0]!.endsWith("…"));
});

test("loadedLines: expanded, one line per memory with type and the graph link marked", () => {
	const open = loadedLines(memories, 80, true);
	assert.equal(open.length, 3);
	assert.match(open[0]!, /\(2\)$/);
	assert.equal(open[1], "  #r5 [preferenza] Niente commit senza richiesta");
	assert.equal(open[2], "  #r3 [fatto] collegato: komorebi su Windows");
});
