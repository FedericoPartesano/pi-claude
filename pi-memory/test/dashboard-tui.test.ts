import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DreamRun, MemoryDashboardSource, RecallEvent, SearchHit } from "../src/dashboard-data.ts";
import { MemoryDashboard, type DashboardResult } from "../src/dashboard-tui.ts";
import type { MemoryRecord } from "../src/store.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_pi:c\x07/g, "");
const KEY = { tab: "\t", down: "\x1b[B", enter: "\r", escape: "\x1b", backspace: "\x7f" };
const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "preferenza", text, pinned: false, confirmations: 1, created: "2026-10-06", last: "2026-10-06", status: "active", entities: [], ...extra });

function setup() {
	let records = [
		rec("r1", "Messaggi d'errore sempre in italiano.", { type: "correzione", pinned: true, confirmations: 3, created: "2026-10-05" }),
		rec("r2", "Il package manager è pnpm.", { entities: ["pnpm"] }),
		rec("r3", "Usavamo npm.", { status: "superseded", reason: "superato da pnpm" }),
		rec("g:r1", "Rispondi in italiano.", { created: "2026-10-05" }),
	];
	const runs: DreamRun[] = [{ at: "2026-10-06T14:09:00", date: "2026-10-06", scope: "progetto", counts: { added: 1, reinforced: 1, merged: 0, updated: 0, forgotten: 0 }, lines: ["+ [preferenza] Il package manager è pnpm.", "↑ Messaggi d'errore sempre in italiano."], tokens: 1200 }];
	const events: RecallEvent[] = [{ at: "2026-10-07T09:12:00", query: "installa le dipendenze", hits: [{ id: "r2", score: 0.82 }], ms: 2 }];
	const calls: string[] = [];
	const source: MemoryDashboardSource = {
		load: () => ({ records, runs, events, lastDream: "2026-10-06", where: ".pi/memory" }),
		search: async (question) => (calls.push(`search:${question}`), [{ record: records[1], score: 0.9 }] as SearchHit[]),
		answer: async (question, hits, onText) => {
			calls.push(`answer:${question}:${hits.length}`);
			onText("Usi **pnpm**");
			return "Usi **pnpm** [r2].";
		},
		act: async (id, action) => {
			calls.push(`act:${id}:${action.kind}`);
			if (action.kind === "pin") records = records.map((record) => (record.id === id ? { ...record, pinned: !record.pinned } : record));
		},
	};
	const results: DashboardResult[] = [];
	let renders = 0;
	const dashboard = new MemoryDashboard(source, theme, (result) => results.push(result), () => renders++, () => 30, "2026-10-07");
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
	assert.match(dashboard.render(120).map(strip)[0], /esc chiudi ╮$/, "top border complete");
	assert.match(text(), /3 attivi · 1 📌 · 1 superato · progetto 2 · globale 1 · ultimo \/dream 06\/10/);
	assert.match(text(), /⟦1 Ricordi⟧ +2 Cronologia +3 Richiami +4 Chiedi/);
});

test("Ricordi: grouped by type, details of the selected memory, filters", () => {
	const { dashboard, text } = setup();
	assert.match(text(), /CORREZIONI · 1/);
	assert.match(text(), /PREFERENZE · 2/);
	assert.match(text(), /› 📌 Messaggi d'errore sempre in italiano\./);
	assert.match(text(), /forza: .* confermato 3 volte/);
	assert.match(text(), /origine: \/dream del 2026-10-06 \(progetto\)/);
	dashboard.handleInput(KEY.down);
	assert.match(text(), /richiamato: 1 volta · ultima 2026-10-07 09:12/);
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
	assert.match(text(), /06\/10\s+█+\s+2 · \/dream ×1/);
	assert.match(text(), /05\/10\s+█+\s+2/);
	assert.match(text(), /\/dream progetto 14:09 · 1200 token/);
	assert.match(text(), /\+1 nuovi ↑1 rinforzati/);
	assert.match(text(), /\+ \[preferenza\] Il package manager è pnpm\./);
});

test("Richiami: requests with the recalled memories and scores, and the most recalled", () => {
	const { dashboard, text } = setup();
	dashboard.handleInput("3");
	assert.match(text(), /09:12  1 ◇ installa le dipendenze/);
	assert.match(text(), /più richiamati:/);
	assert.match(text(), /1× Il package manager è pnpm\./);
	assert.match(text(), /▰+▱* Il package manager è pnpm\./);
});

test("Chiedi: Enter searches the memory (no tokens), Enter again asks the model; Esc closes", async () => {
	const { dashboard, calls, results, text } = setup();
	dashboard.handleInput("4");
	for (const char of "uso pnpm?") dashboard.handleInput(char);
	assert.match(text(), /❯ uso pnpm\?/);
	dashboard.handleInput(KEY.enter);
	await tick();
	assert.deepEqual(calls, ["search:uso pnpm?"]);
	assert.match(text(), /1 ricordo pertinente/);
	assert.match(text(), /invio: risposta del modello/);
	dashboard.handleInput(KEY.enter);
	await tick();
	assert.ok(calls.includes("answer:uso pnpm?:1"));
	assert.match(text(), /Usi pnpm \[r2\]\./);
	assert.doesNotMatch(text(), /\*\*/, "markdown bold rendered, not shown raw");
	dashboard.handleInput(KEY.escape);
	assert.deepEqual(results, [undefined]);
	dashboard.dispose();
});
