import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DreamRun, MemoryDashboardSource, RecallEvent, SearchHit } from "../src/dashboard-data.ts";
import { MemoryDashboard, type DashboardResult } from "../src/dashboard-tui.ts";
import type { MemoryRecord } from "../src/store.ts";

const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_pi:c\x07/g, "");
const KEY = { tab: "\t", down: "\x1b[B", enter: "\r", escape: "\x1b", backspace: "\x7f" };
const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "preferenza", text, pinned: false, confirmations: 1, created: "2026-10-06", last: "2026-10-06", status: "active", entities: [], ...extra });

function setup(only?: string[]) {
	let records = [
		rec("r1", "Messaggi d'errore sempre in italiano.", { type: "correzione", pinned: true, confirmations: 3, created: "2026-10-05" }),
		rec("r2", "Il package manager è pnpm.", { entities: ["pnpm"] }),
		rec("r3", "Usavamo npm.", { status: "superseded", reason: "superato da pnpm" }),
		rec("g:r1", "Rispondi in italiano.", { created: "2026-10-05" }),
	];
	const runs: DreamRun[] = [{ at: "2026-10-06T14:09:00", date: "2026-10-06", scope: "progetto", counts: { added: 1, reinforced: 1, merged: 0, updated: 0, forgotten: 0 }, lines: ["+ [preferenza] Il package manager è pnpm.", "↑ Messaggi d'errore sempre in italiano."], tokens: 1200 }];
	const events: RecallEvent[] = [{ at: "2026-10-07T09:12:00", query: "installa le dipendenze", hits: [{ id: "r2", score: 0.82 }], ms: 2 }];
	let doubts = [{ id: "r2", question: "Ieri hai detto npm, oggi pnpm: vale solo pnpm?", text: "Il package manager è pnpm, mai npm.", at: "2026-10-07T08:00:00Z" }, { id: "r1", question: "Messaggi in inglese per questo progetto?", at: "2026-10-07T08:00:01Z" }];
	const calls: string[] = [];
	const source: MemoryDashboardSource = {
		load: () => ({ records, doubts, runs, events, lastDream: "2026-10-06", where: ".pi/memory" }),
		search: async (question) => (calls.push(`search:${question}`), [{ record: records[1], score: 0.9 }] as SearchHit[]),
		answer: async (question, hits, onText) => {
			calls.push(`answer:${question}:${hits.length}`);
			onText("Usi **pnpm**");
			return "Usi **pnpm** [r2].";
		},
		propose: async (record, request, comment) => {
			calls.push(`propose:${record.id}:${request ?? "-"}:${comment}`);
			if (comment.includes("rompi")) throw new Error("modello non raggiungibile");
			return comment.includes("testo") ? { summary: "Era impreciso.", action: "edit", text: "Il package manager è pnpm, mai npm." } : { summary: "Non c'entra con quella richiesta.", action: "avoid" };
		},
		resolveDoubt: async (id) => {
			calls.push(`resolve:${id}`);
			doubts = doubts.filter((doubt) => doubt.id !== id);
		},
		act: async (id, action) => {
			calls.push(`act:${id}:${action.kind}`);
			if (action.kind === "pin") records = records.map((record) => (record.id === id ? { ...record, pinned: !record.pinned } : record));
		},
	};
	const results: DashboardResult[] = [];
	let renders = 0;
	const dashboard = new MemoryDashboard(source, theme, (result) => results.push(result), () => renders++, () => 30, "2026-10-07", "ricordi", only ? { only } : {});
	return { dashboard, calls, results, text: (width = 120) => dashboard.render(width).map(strip).join("\n") };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("every line fits the width; header has the summary and the four views", () => {
	const { dashboard, text } = setup();
	for (const width of [80, 120, 160]) {
		const lines = dashboard.render(width);
		assert.equal(lines.length, 30);
		for (const line of lines) assert.equal(visibleWidth(line), width, strip(line));
	}
	assert.match(text(), /MEMORIA/);
	const [top, title] = dashboard.render(120).map(strip);
	assert.match(top, /^╭─+╮$/, "top border complete");
	assert.match(title, /^│ +◆ MEMORIA +\.pi\/memory +esc +chiudi │$/, "title bar with the close key");
	assert.match(text(), /ATTIVI +FISSATI +SUPERATI +PROGETTO\/GLOBALE +ULTIMO \/DREAM +RICHIAMI OGGI/);
	assert.match(text(), /│ 3 +1 📌 +1 +2 · 1 +06\/10 +1 /);
	assert.match(text(), /1 Ricordi 3 +2 Cronologia 2 +3 Richiami 1 +4 Chiedi/);
	assert.match(text(), /━━━/, "active tab underlined");
});

test("Ricordi: grouped by type, details of the selected memory, filters", () => {
	const { dashboard, text } = setup();
	assert.match(text(), /✗ CORREZIONI · 1 ─+/);
	assert.match(text(), /★ PREFERENZE · 2 ─+/);
	assert.match(text(), /▎ ✗ 📌 Messaggi d'errore sempre in italiano\./, "selected row");
	assert.match(text(), /✗ CORREZIONE +📌 FISSATO +ATTIVO +PROGETTO/);
	assert.match(text(), /▌ Messaggi d'errore sempre in italiano\./);
	assert.match(text(), /DETTAGLI ─+/);
	assert.match(text(), /Forza +▰+▱* \d+%/);
	assert.match(text(), /Conferme +3 volte/);
	assert.match(text(), /Origine +\/dream del 06\/10 · progetto/);
	dashboard.handleInput(KEY.down);
	assert.match(text(), /Richiamato +1 volta · ultima 2026-10-07 09:12/);
	assert.match(text(), /Entità +pnpm/);
	dashboard.handleInput("/");
	for (const char of "pnpm") dashboard.handleInput(char);
	assert.doesNotMatch(text(), /Messaggi d'errore/);
	dashboard.handleInput(KEY.escape);
	assert.equal(setup().results.length, 0);
	dashboard.handleInput("s");
	assert.match(text(), /superati/);
});

test("Ricordi actions: p pins, d asks before deleting, e asks the opener for the editor", async () => {
	const { dashboard, calls, results } = setup();
	dashboard.handleInput(KEY.down);
	dashboard.handleInput("p");
	await tick();
	assert.ok(calls.includes("act:r2:pin"));
	dashboard.handleInput("d");
	dashboard.handleInput("q");
	await tick();
	assert.ok(!calls.some((call) => call.endsWith(":delete")), "another key cancels");
	dashboard.handleInput("d");
	dashboard.handleInput("d");
	await tick();
	assert.ok(calls.some((call) => call.endsWith(":delete")));
	dashboard.handleInput("e");
	assert.equal(results.length, 1);
	assert.deepEqual(results[0]?.view, "ricordi");
});

test("Cronologia: days with a bar of new memories, the /dream runs and what they saved", () => {
	const { dashboard, text } = setup();
	dashboard.handleInput("2");
	assert.match(text(), /06\/10 +█+░* +2 +◆ 1/);
	assert.match(text(), /05\/10 +█+░* +2 +·/);
	assert.match(text(), /6 ottobre 2026 +2 ricordi nuovi/);
	assert.match(text(), /\/DREAM PROGETTO ─+ 14:09 · 1200 token/);
	assert.match(text(), /\+1 nuovi +↑1 +⇄0 +✎0 +−0/);
	assert.match(text(), /\+ \[preferenza\] Il package manager è pnpm\./);
});

test("Richiami: requests with the recalled memories and scores, and the most recalled", () => {
	const { dashboard, text } = setup();
	dashboard.handleInput("3");
	assert.match(text(), /09:12 +◇ 1 +installa le dipendenze/);
	assert.match(text(), /PIÙ RICHIAMATI ─+ 1 oggi · 1 in tutto/);
	assert.match(text(), /█+ 1× Il package manager è pnpm\./);
	assert.match(text(), /RICORDI AGGIUNTI AL CONTESTO/);
	assert.match(text(), /82% ▰+▱* Il package manager è pnpm\./);
});

test("Chiedi: Enter searches the memory (no tokens), Enter again asks the model; Esc closes", async () => {
	const { dashboard, calls, results, text } = setup();
	dashboard.handleInput("4");
	for (const char of "uso pnpm?") dashboard.handleInput(char);
	assert.match(text(), /│ ❯ uso pnpm\?▏/, "question in an input box");
	dashboard.handleInput(KEY.enter);
	await tick();
	assert.deepEqual(calls, ["search:uso pnpm?"]);
	assert.match(text(), /1 ricordo pertinente/);
	assert.match(text(), /90% ▰+ Il package manager è pnpm\./);
	assert.match(text(), /invio +risposta del modello/);
	dashboard.handleInput(KEY.enter);
	await tick();
	assert.ok(calls.includes("answer:uso pnpm?:1"));
	assert.match(text(), /RISPOSTA DAI RICORDI ─+ 1 ricordo usato/);
	assert.match(text(), /Usi pnpm \[r2\]\./);
	assert.doesNotMatch(text(), /\*\*/, "markdown bold rendered, not shown raw");
	dashboard.handleInput(KEY.escape);
	assert.deepEqual(results, [undefined]);
	dashboard.dispose();
});

test("ricerca per id: #r2 trova solo r2, #g:r1 solo il globale, senza # l'id esatto vale anche", () => {
	const type = (dashboard: ReturnType<typeof setup>["dashboard"], word: string) => { dashboard.handleInput("/"); for (const char of word) dashboard.handleInput(char); };
	for (const [word, shown, hidden] of [["#r2", /package manager/, /Messaggi d'errore|Rispondi in italiano/], ["#g:r1", /Rispondi in italiano/, /package manager|Messaggi d'errore/], ["r2", /package manager/, /Messaggi d'errore/]] as const) {
		const { dashboard, text } = setup();
		type(dashboard, word);
		assert.match(text(), shown, word);
		assert.doesNotMatch(text(), hidden, word);
	}
});

const type = (dashboard: ReturnType<typeof setup>["dashboard"], word: string) => { for (const char of word) dashboard.handleInput(char); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("solo i ricordi caricati: elenco ristretto, a torna a tutti", () => {
	const { dashboard, text } = setup(["r2", "g:r1"]);
	assert.match(text(), /caricati nell'ultima risposta/);
	assert.match(text(), /package manager/);
	assert.match(text(), /Rispondi in italiano/);
	assert.doesNotMatch(text(), /Messaggi d'errore/);
	dashboard.handleInput("a");
	assert.match(text(), /Messaggi d'errore/);
	assert.doesNotMatch(text(), /caricati nell'ultima risposta/);
});

test("correggi: scrivi, il modello propone, invio applica (avoid con la richiesta che l'ha fatto scattare)", async () => {
	const { dashboard, calls, text } = setup();
	dashboard.handleInput(KEY.down); // r2 è l'ultimo richiamato dall'evento
	dashboard.handleInput("c");
	assert.match(text(), /CORREGGI IL RICORDO/);
	assert.match(text(), /installa le dipendenze/);
	type(dashboard, "non c'entra");
	dashboard.handleInput(KEY.enter);
	await settle();
	assert.ok(calls.some((call) => call.startsWith("propose:r2:installa le dipendenze:non c'entra")), calls.join("|"));
	assert.match(text(), /PROPOSTA DEL MODELLO/);
	assert.match(text(), /non richiamarlo più per richieste come questa/);
	assert.ok(!calls.some((call) => call.startsWith("act:")), "niente cambia prima della conferma");
	dashboard.handleInput(KEY.enter);
	await settle();
	assert.ok(calls.includes("act:r2:avoid"), calls.join("|"));
	assert.doesNotMatch(text(), /CORREGGI/);
});

test("correggi: esc annulla senza cambiare niente; n permette di riscrivere; errore del modello mostrato", async () => {
	const { dashboard, calls, text } = setup();
	dashboard.handleInput(KEY.down);
	dashboard.handleInput("c");
	type(dashboard, "rompi");
	dashboard.handleInput(KEY.enter);
	await settle();
	assert.match(text(), /errore: modello non raggiungibile/);
	for (let i = 0; i < 5; i++) dashboard.handleInput(KEY.backspace);
	type(dashboard, "correggi il testo");
	dashboard.handleInput(KEY.enter);
	await settle();
	assert.match(text(), /nuovo testo: Il package manager è pnpm, mai npm\./);
	dashboard.handleInput("n");
	assert.doesNotMatch(text(), /PROPOSTA DEL MODELLO/);
	dashboard.handleInput(KEY.escape);
	assert.doesNotMatch(text(), /CORREGGI/);
	assert.ok(!calls.some((call) => call.startsWith("act:")));
});

test("correggi: invio con commento vuoto non chiama il modello", async () => {
	const { dashboard, calls } = setup();
	dashboard.handleInput(KEY.down);
	dashboard.handleInput("c");
	dashboard.handleInput(KEY.enter);
	await settle();
	assert.ok(!calls.some((call) => call.startsWith("propose:")));
});

test("tab Dubbi: elenco con conteggio, dettaglio con cosa succede se dici sì; 5 apre la tab", () => {
	const { dashboard, text } = setup();
	assert.match(text(), /5 Dubbi 2/);
	dashboard.handleInput("5");
	assert.match(text(), /Ieri hai detto npm, oggi pnpm/);
	assert.match(text(), /DUBBIO DI \/DREAM/);
	assert.match(text(), /diventa: Il package manager è pnpm, mai npm\./);
	dashboard.handleInput(KEY.down);
	assert.match(text(), /viene segnato come superato/);
});

test("tab Dubbi: s applica l'azione e toglie il dubbio; n lo toglie senza toccare il ricordo", async () => {
	const { dashboard, calls, text } = setup();
	dashboard.handleInput("5");
	dashboard.handleInput("s");
	await tick();
	assert.deepEqual(calls.filter((call) => call.startsWith("act:") || call.startsWith("resolve:")), ["act:r2:edit", "resolve:r2"]);
	assert.match(text(), /5 Dubbi 1/);
	dashboard.handleInput("n");
	await tick();
	assert.ok(calls.includes("resolve:r1"));
	assert.ok(!calls.includes("act:r1:supersede"));
	assert.match(text(), /nessun dubbio in sospeso/);
});

test("tab Dubbi: invio apre la chat, il modello propone, invio applica e il dubbio sparisce", async () => {
	const { dashboard, calls, text } = setup();
	dashboard.handleInput("5");
	dashboard.handleInput(KEY.enter);
	assert.match(text(), /LA TUA RISPOSTA/);
	for (const char of "ho cambiato idea, testo nuovo") dashboard.handleInput(char);
	dashboard.handleInput(KEY.enter);
	await tick();
	assert.ok(calls.some((call) => call.startsWith("propose:r2:-:Dubbio emerso da /dream")), calls.join("|"));
	assert.match(text(), /PROPOSTA DEL MODELLO/);
	dashboard.handleInput(KEY.enter);
	await tick();
	assert.deepEqual(calls.filter((call) => call.startsWith("act:") || call.startsWith("resolve:")), ["act:r2:edit", "resolve:r2"]);
});
