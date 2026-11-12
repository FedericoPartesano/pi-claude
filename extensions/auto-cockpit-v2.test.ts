// Second batch of the /auto screen (cockpit): one test per requirement of auto/requisiti.json, selected with --test-name-pattern "^Rn:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newState, type AutoState } from "./auto/state.ts";
import type { DiaryEvent } from "./auto/diary.ts";
// @ts-ignore: plain JS module of the prototype chat
import * as cockpit from "../prototype/rpc-chat/cockpit.mjs";

const { cockpitRows, createFeed, wrapPlain } = cockpit as any;
const plain = (rows: string[]) => rows.map((r) => r.replace(/\x1b\[[0-9;]*m/g, ""));
const baseState = (over: Partial<AutoState> = {}): AutoState =>
	newState({ goal: "g", slug: "demo", branch: "auto/demo", repo: "/r", worktree: "/w", base: "x", intent: "i", started: 0, deadline: 3_600_000, ...over });
const reqs = (n: number, done: number) => Array.from({ length: n }, (_, i) => ({ id: `R${i + 1}`, descrizione: `requisito numero ${i + 1}`, check: "true", prova: "p", passes: i < done }));
const TEXT = "Ho scritto il modulo di caricamento e aggiunto i test che coprono il caso vuoto, il caso con errori e quello con molte righe lunghe da mandare a capo.";
const evs = (): DiaryEvent[] => [
	{ t: "step", at: 1000, n: 1, phase: "build" },
	{ t: "tool", at: 1100, n: 1, name: "bash", arg: "npm test" },
	{ t: "tool", at: 1200, n: 1, name: "edit", arg: "src/a.ts" },
	{ t: "end", at: 9000, n: 1, ok: true, ms: 8000, tokens: 12000, text: TEXT },
	{ t: "check", at: 9100, id: "R1", ok: true },
	{ t: "check", at: 9100, id: "R2", ok: false, out: "boom" },
	{ t: "step", at: 10000, n: 2, phase: "build" },
	{ t: "tool", at: 10100, n: 2, name: "read", arg: "src/b.ts" },
];
const ui0 = () => ({ sel: -1, top: 0, note: null });
const render = (over: any = {}) => plain(cockpitRows({ state: baseState({ requirements: reqs(3, 1), steps: 2 }), events: evs(), now: 14_000, W: 110, H: 30, usage: 0.3, ui: ui0(), ...over }));

test("R1: one-line header answers 'is it moving, why'", () => {
	const r = render();
	const head = r[0];
	for (const re of [/AUTO/, /fase build/, /passo 2\/60/, /PROCEDE/, /nessun segnale di rischio/, /fermo da 4s/, /IN DIRETTA/]) assert.match(head, re);
	assert.ok(head.length <= 110);
	assert.doesNotMatch(r.join("\n"), /undefined/);
	const risky = render({ state: baseState({ requirements: reqs(3, 1), steps: 2, stall: 2 }), usage: undefined });
	assert.match(risky[0], /A RISCHIO.*stallo 2\/3/);
	const narrow = render({ W: 60 })[0];
	assert.ok(narrow.length <= 60);
	assert.match(narrow, /PROCEDE/);
});

test("R2: requirement list with n/m, current highlighted, scrolls with many", () => {
	const few = render().join("\n");
	assert.match(few, /1\/3/);
	assert.match(few, /✓ R1/);
	assert.match(few, /▸ R2/);
	assert.match(few, /○ R3/);
	for (const W of [110, 60]) {
		const many = render({ state: baseState({ requirements: reqs(40, 29), steps: 30 }), W, H: 20, usage: undefined });
		assert.equal(many.length, 20);
		assert.ok(many.some((l) => /▸ R30\b/.test(l)), `current requirement visible at ${W}`);
		assert.ok(many.some((l) => /29\/40/.test(l)));
	}
	const failed = render({ state: baseState({ requirements: reqs(3, 0), steps: 2 }), usage: undefined }).join("\n");
	assert.match(failed, /✖ R2/, "a requirement whose last check failed is red");
});

test("R3: live step shows the last tools and the final text wrapped at word boundaries", () => {
	assert.deepEqual(wrapPlain("aa bbb cc ddddd", 6), ["aa bbb", "cc", "ddddd"]);
	assert.deepEqual(wrapPlain("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	const many: DiaryEvent[] = [{ t: "step", at: 1, n: 1, phase: "build" }, ...Array.from({ length: 12 }, (_, i) => ({ t: "tool", at: 2 + i, n: 1, name: "read", arg: `src/f${i}.ts` }) as DiaryEvent), { t: "end", at: 99, n: 1, ok: true, ms: 5000, tokens: 900, text: TEXT }];
	for (const W of [60, 80, 110]) {
		const rows = render({ W, events: many, H: 30 });
		assert.ok(rows.every((l) => l.length <= W), `fits ${W}`);
		const all = rows.join("\n");
		assert.match(all, /read src\/f11\.ts/, "last tool shown");
		assert.doesNotMatch(all, /read src\/f0\.ts/, "old tools dropped");
		const words = all.split(/\s+/);
		for (const w of TEXT.split(/\s+/)) assert.ok(words.includes(w), `word '${w}' intact at ${W}`);
	}
});

test("R4: adaptive layout, no row wider than the terminal at any width", () => {
	const state = baseState({ requirements: reqs(12, 4), steps: 2, notes: ["x"], paused: true });
	for (const W of [40, 50, 59, 69, 70, 79, 80, 110, 200]) {
		const rows = render({ W, H: 24, state });
		assert.equal(rows.length, 24, `height at ${W}`);
		assert.ok(rows.every((l) => l.length <= W), `fits ${W}`);
		assert.match(rows[0], /AUTO/);
		assert.match(rows[0], /PROCEDE|A RISCHIO|FERMA/, `health kept at ${W}`);
		if (W < 70) assert.ok(!rows.some((l) => l.includes("│")), `stacked at ${W}`);
		if (W >= 80) assert.ok(rows.some((l) => l.includes("│")), `columns at ${W}`);
	}
	assert.deepEqual(render({ W: 50 }), render({ W: 50 }));
});

test("R5: RIVEDI shows 'k di n', outcome, duration, tokens; esc or → past the last returns live", () => {
	const all = render({ ui: { sel: 0, top: 0, note: null } }).join("\n");
	assert.match(all, /RIVEDI passo 1 di 2/);
	assert.match(all, /esito: riuscito/);
	assert.match(all, /8s/);
	assert.match(all, /12k token/);
	const nav = cockpit.navigate as (ui: any, groups: number, key: string) => string;
	const ui = { sel: -1, top: 0, note: null, seen: 0 };
	assert.equal(nav(ui, 3, "left"), "review");
	assert.equal(ui.sel, 1);
	assert.equal(nav(ui, 3, "right"), "live");
	assert.equal(ui.sel, -1);
	nav(ui, 3, "left"); nav(ui, 3, "left");
	assert.equal(ui.sel, 0);
	assert.equal(nav(ui, 3, "esc"), "live", "esc in RIVEDI goes live, not close");
	assert.equal(ui.sel, -1);
	assert.equal(nav(ui, 3, "esc"), "close", "esc when live closes the view");
});

test("R6: empty and abnormal states say what happened and which key to press", () => {
	const empty = (problem: string) => plain(cockpitRows({ state: undefined, problem, events: [], now: 1, W: 80, H: 12, usage: undefined, ui: ui0() })).join("\n");
	assert.match(empty("assente"), /Nessuna corsa/);
	assert.match(empty("assente"), /\/auto/);
	assert.match(empty("illeggibile"), /illeggibile/);
	assert.match(empty("illeggibile"), /\bq\b/);
	const dir = mkdtempSync(join(tmpdir(), "feed2-"));
	const missing = createFeed(join(dir, "nope.json"));
	missing.refresh();
	assert.equal(missing.state, undefined);
	assert.equal(missing.problem, "assente");
	const file = join(dir, "x.json");
	writeFileSync(file, "{ not json");
	const corrupt = createFeed(file);
	corrupt.refresh();
	assert.equal(corrupt.state, undefined);
	assert.equal(corrupt.problem, "illeggibile");
	writeFileSync(file, JSON.stringify(baseState({ requirements: reqs(2, 0) })));
	assert.equal(corrupt.refresh(), true);
	assert.equal(corrupt.problem, undefined, "recovers when the file becomes valid");
	assert.ok(corrupt.state);
	const noDiary = render({ state: baseState({ requirements: reqs(2, 0), steps: 0 }), events: [], now: 5000, W: 80, H: 14, usage: undefined });
	assert.ok(noDiary.every((l) => l.length <= 80));
	assert.match(noDiary.join("\n"), /nessun passo|in avvio|diario/i, "no diary yet is explained");
	const finished = render({ state: baseState({ requirements: reqs(2, 2), stop: { reason: "completato", detail: "ok", at: 5 } }), W: 80, H: 14, usage: undefined }).join("\n");
	assert.match(finished, /\/land/);
});

test("R7: contextual key row and 'in attesa' beside the keys", () => {
	const last = (o: any) => render(o).slice(-2).join("\n");
	const run = last({});
	assert.match(run, /p pausa/); assert.match(run, /: nota/); assert.match(run, /s stop/);
	const pend = last({ state: baseState({ requirements: reqs(3, 1), steps: 2, paused: true, notes: ["a", "b"] }) });
	assert.match(pend, /in attesa: pausa al prossimo passo · 2 note/);
	const resumed = render({ state: baseState({ requirements: reqs(3, 1), steps: 2, paused: true }), events: [...evs(), { t: "cmd", at: 11_000, cmd: "pausa", applied: true } as DiaryEvent] });
	assert.match(resumed.at(-1)!, /p riprendi/);
	assert.doesNotMatch(resumed.at(-1)!, /p pausa/);
	const stopped = render({ state: baseState({ requirements: reqs(3, 3), stop: { reason: "completato", detail: "ok", at: 5 } }) }).at(-1)!;
	assert.doesNotMatch(stopped, /pausa|riprendi|nota|stop/);
	const review = render({ ui: { sel: 0, top: 0, note: null } }).at(-1)!;
	assert.doesNotMatch(review, /p pausa|s stop/);
	assert.match(review, /diretta/);
	assert.equal(typeof cockpit.keyHints, "function", "keyHints is exported and pure");
});

test("R8: cost: header-only redraw on the tick, one 1 s timer, no model call", () => {
	assert.equal(typeof cockpit.cockpitHead, "function");
	const args = { state: baseState({ requirements: reqs(3, 1), steps: 2 }), events: evs(), now: 14_000, W: 100, H: 30, usage: 0.2, ui: ui0() };
	const head = cockpit.cockpitHead(args) as string[];
	assert.equal(head.length, 1);
	assert.equal(head[0], cockpitRows(args)[0]);
	const chat = readFileSync(new URL("../prototype/rpc-chat/chat.mjs", import.meta.url), "utf8");
	const open = chat.slice(chat.indexOf("const cockpitOpen"), chat.indexOf("const cockpitClose"));
	assert.equal((open.match(/setInterval\(/g) ?? []).length, 1, "a single timer");
	assert.match(open, /\},\s*1000\)/, "1 s period");
	assert.match(open, /cockpitHead|headOnly/, "the tick redraws only the header when nothing else changed");
	assert.doesNotMatch(readFileSync(new URL("../prototype/rpc-chat/cockpit.mjs", import.meta.url), "utf8"), /setInterval|setTimeout|send\(/);
});
