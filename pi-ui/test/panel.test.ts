import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseAheadBehind, parseNumstat, parsePorcelain, renderPanel, type PanelInfo } from "../src/panel.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const info: PanelInfo = {
	session: new Map([["goal", "goal 2/5"], ["loop", "loop 5m · giro 3 · prossimo 04:12"], ["team", "team t2/4 tester"]]),
	files: [{ status: "M", path: "src/cart.js", added: 1, removed: 1 }, { status: "A", path: "test/cart.test.js", added: 18, removed: 0 }],
	failures: ["totalValue · test/cart.test.js:12 · ricevuto 29.9, atteso 59.8"],
	image: { ref: "out/vendite.png", lines: ["\x1b[38;2;1;2;3m\x1b[48;2;4;5;6m▀\x1b[0m".repeat(36)] },
	usage: { fiveHour: 0.34, sevenDay: 0.18, contextPercent: 41, contextTokens: 82_000, contextWindow: 200_000, model: "sonnet", thinking: "medium" },
};

test("the panel lists session, files, failing tests, last image and usage at its exact width", () => {
	const lines = renderPanel(info, 40, "alt+s");
	for (const line of lines) assert.equal(visibleWidth(line), 40);
	const text = lines.map(strip).join("\n");
	assert.match(text, /PANNELLO\s+alt\+s chiudi/);
	assert.match(renderPanel(info, 40, "f2").map(strip)[0], /f2 chiudi/);
	assert.match(text, /GOAL 2\/5/);
	assert.match(text, /LOOP 5m · giro 3/);
	assert.match(text, /TEAM t2\/4 tester/);
	assert.match(text, /FILE ─+ ✚2/);
	assert.match(text, /M src\/cart.js\s+\+1 -1/);
	assert.match(text, /A test\/cart.test.js\s+\+18/);
	assert.match(text, /TEST ─+ 1 ✗/);
	assert.match(text, /✗ totalValue/);
	assert.match(text, /IMMAGINI/);
	assert.match(text, /5H\s+▰+▱+ 34%/);
	assert.match(text, /CTX\s+▰+▱+ 41%/);
	assert.match(text, /82k\/200k · sonnet·medium/);
});

test("empty sections are left out", () => {
	const text = renderPanel({ ...info, session: new Map(), files: [], failures: [], image: undefined }, 40, "alt+s").map(strip).join("\n");
	assert.match(text, /nessun goal, loop o team/);
	assert.doesNotMatch(text, /FILE|TEST|IMMAGINI/);
	assert.match(text, /USO/);
});

test("git porcelain and numstat parsing", () => {
	assert.deepEqual(parsePorcelain(" M src/a.js\n?? new.txt\nR  old.js -> new.js\n D gone.js\n"), [
		{ status: "M", path: "src/a.js" },
		{ status: "A", path: "new.txt" },
		{ status: "R", path: "new.js" },
		{ status: "D", path: "gone.js" },
	]);
	assert.deepEqual(parseNumstat("1\t1\tsrc/a.js\n-\t-\timg.png\n"), new Map([["src/a.js", { added: 1, removed: 1 }], ["img.png", { added: 0, removed: 0 }]]));
});

test("richer panel: turn, latest activity with times, git, memory and suggestions", () => {
	const lines = renderPanel({
		...info,
		turn: { mode: "done", steps: 5, seconds: 48, tokensIn: 12_400, tokensOut: 2100 },
		activity: [
			{ time: "14:09:02", icon: "✓", ok: true, text: "Leggo cart.js" },
			{ time: "14:09:05", icon: "✓", ok: true, text: "Modifico cart.js" },
			{ time: "14:09:09", icon: "✗", ok: false, text: "Eseguo i test" },
		],
		git: { branch: "feat/pi-ui", ahead: 2, behind: 0, lastCommit: "feat(pi-ui): charts drawn in the terminal" },
		memory: "◇ 3 ricordi richiamati · 12 (2 📌)",
		suggestions: ["apri il grafico", "mostra il diff"],
	}, 40, "alt+s");
	for (const line of lines) assert.equal(visibleWidth(line), 40);
	const text = lines.map(strip).join("\n");
	assert.match(text, /TURNO ─+ ✓/);
	assert.match(text, /5 passi · 48s · ↑12,4k ↓2,1k/);
	assert.match(text, /ATTIVITÀ/);
	assert.match(text, /14:09:09 ✗ Eseguo i test/);
	assert.match(text, /GIT ─+/);
	assert.match(text, /⎇ feat\/pi-ui ↑2/);
	assert.match(text, /feat\(pi-ui\): charts/);
	assert.match(text, /MEMORIA ─+/);
	assert.match(text, /3 ricordi richiamati/);
	assert.match(text, /\/memory/);
	assert.match(text, /SUGGERIMENTI/);
	assert.match(text, /⟦1⟧ apri il grafico/);
	// Most useful first: session and turn before files, usage last.
	assert.ok(text.indexOf("TURNO") < text.indexOf("FILE") && text.indexOf("FILE") < text.indexOf("USO"));
});

test("parseAheadBehind reads git rev-list --left-right --count", () => {
	assert.deepEqual(parseAheadBehind("0\t2\n"), { behind: 0, ahead: 2 });
	assert.deepEqual(parseAheadBehind(""), { behind: 0, ahead: 0 });
});

test("the panel shows sub-agents with how many are active", () => {
	const text = renderPanel({ ...info, agents: [
		{ key: "a", name: "t1 implementer", task: "Implementa cart", state: "running", startedAt: 1000, doing: "eseguo i test" },
		{ key: "b", name: "t2 tester", task: "Scrivi i test", state: "queued" },
	], now: 13_000 }, 40, "alt+s").map(strip).join("\n");
	assert.match(text, /SUB-AGENTI ─+ 1 attivo \/ 2/);
	assert.match(text, /t1 implementer/);
	assert.ok(text.indexOf("SUB-AGENTI") < text.indexOf("FILE"), "agents come before files");
});

test("plan, intent and savings sections", () => {
	const text = renderPanel({
		...info,
		plan: [{ subject: "Scrivi i test", status: "completed" }, { subject: "Correggi totalValue", status: "in_progress" }, { subject: "Aggiorna il README", status: "pending" }],
		intent: { file: "intents/2026-10-08-sconti.md", title: "Sconti nel carrello", outcomes: ["codice LIBRI10", "test verdi", "README"] },
		saved: 12400,
	}, 40, "alt+s").map(strip).join("\n");
	assert.match(text, /PIANO ─+ 1\/3/);
	assert.match(text, /▸ Correggi totalValue/);
	assert.match(text, /○ Aggiorna il README/);
	assert.match(text, /✓ Scrivi i test/);
	assert.match(text, /INTENT/);
	assert.match(text, /Sconti nel carrello/);
	assert.match(text, /3 risultati attesi/);
	assert.match(text, /RISPARMIO/);
	assert.match(text, /12,4k token risparmiati/);
});

test("too many sections for the height: the least useful ones go first, usage and session always stay", () => {
	const lines = renderPanel({ ...info, plan: Array.from({ length: 6 }, (_, i) => ({ subject: `passo ${i}`, status: "pending" })) }, 40, "alt+s", 22);
	assert.ok(lines.length <= 22, `${lines.length} lines`);
	const text = lines.map(strip).join("\n");
	assert.match(text, /SESSIONE/);
	assert.match(text, /USO/);
	assert.match(text, /PIANO/);
	assert.doesNotMatch(text, /IMMAGINI/);
	assert.match(text, /sezion[ei] nascost[ae]/);
	for (const line of lines) assert.equal(visibleWidth(line), 40);
});

test("the GOAL section: state, progress checklist, round, time and last event, right under the title", () => {
	const goal = {
		state: "attivo" as const, text: "Sconti nel carrello", intentFile: "intents/2026-10-08-sconti.md",
		outcomes: [{ text: "codice LIBRI10", done: true }, { text: "test verdi", done: false }, { text: "verifica in Chrome", done: false }],
		done: 1, total: 3, round: 3, max: 20, minutes: 12, lastEvent: "Chiusura rifiutata · mancano: 2. test verdi", checks: [],
	};
	const lines = renderPanel({ ...info, goal }, 40, "alt+s").map(strip);
	const text = lines.join("\n");
	assert.match(text, /GOAL ─+ ▶ attivo/);
	assert.match(text, /Sconti nel carrello/);
	assert.match(text, /✓ codice LIBRI10/);
	assert.match(text, /○ test verdi/);
	assert.match(text, /1\/3 · giro 3\/20 · 12 min/);
	assert.match(text, /Chiusura rifiutata/);
	assert.ok(lines.findIndex((line) => /GOAL/.test(line)) < lines.findIndex((line) => /SESSIONE/.test(line)), "goal first");
	const paused = renderPanel({ ...info, goal: { ...goal, state: "in pausa" as const, pausedReason: "serve una tua decisione" } }, 40, "alt+s").map(strip).join("\n");
	assert.match(paused, /GOAL ─+ ⏸ in pausa/);
	assert.match(paused, /serve una tua decisione/);
	assert.match(paused, /\/goal resume/);
});
