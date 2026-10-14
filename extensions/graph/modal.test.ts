import assert from "node:assert/strict";
import { test } from "node:test";
import { JobModal } from "./modal.ts";

const make = () => {
	let at = 1_000_000;
	const modal = new JobModal("Test", () => (at += 1000), () => 40);
	let closed = 0;
	let drawn = 0;
	modal.attach(() => drawn++, () => closed++);
	return { modal, closed: () => closed, drawn: () => drawn };
};

test("il modal mostra titolo, barra, log con ora e tasto Esc; ridisegna a ogni cambio", () => {
	const { modal, drawn } = make();
	modal.set({ phase: "estrazione AST", done: 5, total: 10 });
	modal.log("AST extraction: 5/10 files");
	const text = modal.render(80).join("\n");
	assert.match(text, /Test/);
	assert.match(text, /50%\s+5\/10/);
	assert.match(text, /\d\d:\d\d:\d\d AST extraction: 5\/10 files/);
	assert.match(text, /Esc annulla/);
	assert.ok(drawn() >= 2);
	assert.ok(modal.render(80).every((line) => line.length === modal.render(80)[0].length), "righe tutte della stessa larghezza");
});

test("Esc durante il lavoro annulla senza chiudere; a lavoro finito Invio chiude e mostra il risultato", () => {
	const { modal, closed } = make();
	modal.handleInput("x");
	modal.handleInput("\x1b");
	assert.equal(modal.abort.signal.aborted, true);
	assert.equal(closed(), 0);
	assert.match(modal.render(80).join("\n"), /Annullamento in corso/);
	modal.finish("Fatto in 3s");
	assert.match(modal.render(80).join("\n"), /Fatto in 3s[\s\S]*Invio o Esc per chiudere/);
	modal.handleInput("a");
	assert.equal(closed(), 0);
	modal.handleInput("\r");
	assert.equal(closed(), 1);
});

test("il log tiene solo le ultime righe che entrano e scarta le vuote", () => {
	const { modal } = make();
	for (let index = 0; index < 100; index++) modal.log(`riga ${index}`);
	modal.log("   ");
	const text = modal.render(80).join("\n");
	assert.match(text, /riga 99/);
	assert.doesNotMatch(text, /riga 10\b/);
});
