import assert from "node:assert/strict";
import { test } from "node:test";
import { JobModal } from "./modal.ts";

const make = () => {
	let at = 1_000_000;
	const modal = new JobModal("Test", { now: () => (at += 1000), rows: () => 40 });
	let closed = 0;
	let drawn = 0;
	modal.attach(() => drawn++, () => closed++);
	return { modal, closed: () => closed, drawn: () => drawn };
};

test("il modal mostra titolo, barra, log con ora e tasto Esc; ridisegna a ogni cambio", () => {
	const { modal, drawn } = make();
	modal.set({ phase: "estrazione AST", done: 5, total: 10 });
	modal.log("AST extraction: 5/10 files");
	const text = modal.render(80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
	assert.match(text, /Test/);
	assert.match(text, /50%\s+5\/10/);
	assert.match(text, /\d\d:\d\d:\d\d {2}AST extraction: 5\/10 files/);
	assert.match(text, /Esc annulla/);
	assert.ok(drawn() >= 2);
	const widths = modal.render(80).map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length);
	assert.ok(widths.every((width) => width === widths[0]), "righe tutte della stessa larghezza");
});

test("Esc durante il lavoro annulla senza chiudere; a lavoro finito Invio chiude e mostra il risultato", () => {
	const { modal, closed } = make();
	modal.handleInput("x");
	modal.handleInput("\x1b");
	assert.equal(modal.abort.signal.aborted, true);
	assert.equal(closed(), 0);
	assert.match(modal.render(80).join("\n"), /annullamento in corso/);
	modal.finish("Fatto in 3s");
	assert.match(modal.render(80).join("\n"), /Fatto in 3s[\s\S]*Invio o Esc chiude/);
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

test("scheda Interroga: Tab cambia, si scrive, Invio chiede, la risposta compare", async () => {
	const asked: string[] = [];
	const modal = new JobModal("Test", { ask: (text) => (asked.push(text), `risposta a ${text}`), now: () => 1, rows: () => 40 });
	modal.attach(() => {}, () => {});
	assert.equal(modal.tab, "lavoro");
	modal.handleInput("\t");
	assert.equal(modal.tab, "interroga");
	for (const char of "recall") modal.handleInput(char);
	assert.match(modal.render(80).join("\n"), /› recall/);
	modal.handleInput("\r");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(asked, ["recall"]);
	assert.match(modal.render(80).join("\n"), /Risposta a: recall[\s\S]*risposta a recall/);
	modal.handleInput("\t");
	assert.equal(modal.tab, "lavoro");
});

test("senza lavoro il modal si apre su Interroga e Esc lo chiude", () => {
	let closed = 0;
	const modal = new JobModal("Grafo", { job: false, ask: () => "", rows: () => 40 });
	modal.attach(() => {}, () => closed++);
	assert.equal(modal.tab, "interroga");
	modal.handleInput("\x1b");
	assert.equal(closed, 1);
});

test("parseAsk riconosce spiega, percorso e ricerca libera", async () => {
	const { parseAsk } = await import("./modal.ts");
	assert.deepEqual(parseAsk("spiega memory.ts"), { kind: "explain", name: "memory.ts" });
	assert.deepEqual(parseAsk("percorso recall.ts -> store.ts"), { kind: "path", from: "recall.ts", to: "store.ts" });
	assert.deepEqual(parseAsk("percorso a.ts b.ts"), { kind: "path", from: "a.ts", to: "b.ts" });
	assert.deepEqual(parseAsk("come funziona il recall"), { kind: "query", text: "come funziona il recall" });
	assert.equal(parseAsk("  "), undefined);
});

test("schede di sola lettura e azioni: Tab scorre nell'ordine, un tasto lancia l'azione, begin apre Lavoro, confirm aspetta s/n", async () => {
	const ran: string[] = [];
	const modal = new JobModal("Grafo", {
		job: false,
		ask: () => "",
		layout: ["stato", "interroga", "nodi", "lavoro"],
		backTo: "stato",
		pages: [
			{ id: "stato", label: "Stato", body: () => "# Grafo\nNodi:  10", actions: [{ key: "a", label: "aggiorna", run: () => ran.push("a") }] },
			{ id: "nodi", label: "Nodi", body: () => "x" },
		],
		rows: () => 40,
	});
	modal.attach(() => {}, () => {});
	assert.equal(modal.tab, "stato");
	assert.match(modal.render(80).join("\n"), /Grafo[\s\S]*Nodi:\s+10[\s\S]*a aggiorna/);
	modal.handleInput("a");
	assert.deepEqual(ran, ["a"]);
	modal.handleInput("\t");
	assert.equal(modal.tab, "interroga");
	modal.handleInput("\t");
	assert.equal(modal.tab, "nodi");
	modal.handleInput("\t");
	assert.equal(modal.tab, "stato", "Lavoro non c'è finché non parte un lavoro");
	modal.begin("Build");
	assert.equal(modal.tab, "lavoro");
	const answer = modal.confirm("Leggere i documenti?");
	assert.match(modal.render(80).join("\n"), /\? Leggere i documenti\?/);
	modal.handleInput("s");
	assert.equal(await answer, true);
	const no = modal.confirm("Ancora?");
	modal.handleInput("\x1b");
	assert.equal(await no, false);
	modal.finish("Fatto");
	modal.handleInput("\r");
	assert.equal(modal.tab, "stato", "a lavoro finito Invio torna allo stato invece di chiudere");
});
