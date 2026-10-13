import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { BugForm } from "../../extensions/bug/bundle.ts";
import { BugFormModal } from "../src/bug-form.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_pi:c\x07/g, "");
const type = (modal: BugFormModal, text: string) => { for (const char of text) modal.handleInput(char); };

function setup(where?: string) {
	const results: (BugForm | undefined)[] = [];
	const modal = new BugFormModal(theme, where, (form) => results.push(form), () => {}, () => 30);
	return { modal, results, text: () => modal.render(100).map(strip).join("\n") };
}

test("ogni riga ha la larghezza giusta", () => {
	const { modal } = setup("https://x");
	for (const width of [60, 100, 140]) for (const line of modal.render(width)) assert.equal(visibleWidth(line), width, strip(line));
});

test("compila i campi con invio, sceglie la gravità, conferma con invio sull'ultima riga", () => {
	const { modal, results } = setup();
	type(modal, "Todo spariti");
	modal.handleInput("\r");
	type(modal, "dopo la compattazione");
	modal.handleInput("\r");
	type(modal, "10 task");
	modal.handleInput("\r");
	modal.handleInput("\x1b[C"); // severity: fastidio → piccolo
	modal.handleInput("\x1b[C"); // → blocca
	modal.handleInput("\t");
	modal.handleInput(" "); // redact off
	modal.handleInput("\t"); // confirm
	modal.handleInput("\r");
	assert.deepEqual(results, [{ title: "Todo spariti", happened: "dopo la compattazione", expected: "10 task", severity: "blocca", redact: false, send: false }]);
});

test("senza titolo non conferma; ctrl+s conferma da qualsiasi riga; esc annulla", () => {
	const { modal, results, text } = setup();
	modal.handleInput("\x13");
	assert.equal(results.length, 0);
	assert.match(text(), /Il titolo è obbligatorio/);
	type(modal, "x");
	modal.handleInput("\x13");
	assert.equal(results[0]?.title, "x");
	modal.handleInput("\x1b");
	assert.equal(results[1], undefined);
});

test("la riga «invia al server» c'è solo se un server è configurato", () => {
	assert.doesNotMatch(setup().text(), /Invia anche al server/);
	assert.match(setup("https://leopart.ts.net").text(), /Invia anche al server/);
});
