import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, diaryFile, parseDiary, toolArg, type DiaryEvent } from "./auto/diary.ts";
import { runAuto, withNotes, type LoopDeps, type StepRequest } from "./auto/loop.ts";
import { newState, type AutoState } from "./auto/state.ts";
// @ts-ignore: plain JS module of the prototype chat
import { cockpitRows, createFeed, groupSteps, health, pending } from "../prototype/rpc-chat/cockpit.mjs";

const plain = (rows: string[]) => rows.map((r) => r.replace(/\x1b\[[0-9;]*m/g, ""));

// ---- diary ----

test("diary: a half-written last line and a corrupt line are skipped, the rest is read", () => {
	const text = `${JSON.stringify({ t: "step", at: 1, n: 1, phase: "build" })}\nnon json\n${JSON.stringify({ t: "tool", at: 2, n: 1, name: "bash", arg: "ls" })}\n{"t":"end","at`;
	assert.deepEqual(parseDiary(text).map((e) => e.t), ["step", "tool"]);
	assert.deepEqual(parseDiary(`${text}":3}\n`).map((e) => e.t), ["step", "tool", "end"], "the line completed later is read");
});

test("diary: appendEvent cuts long text, toolArg is one short line", () => {
	const dir = mkdtempSync(join(tmpdir(), "diary-"));
	const file = diaryFile(join(dir, "x.json"));
	assert.ok(file.endsWith("x.eventi.jsonl"));
	appendEvent(file, { t: "end", at: 1, n: 1, ok: true, ms: 5, tokens: 1, text: "a".repeat(5000) });
	const [e] = parseDiary(execFileSync("cat", [file], { encoding: "utf8" })) as Extract<DiaryEvent, { t: "end" }>[];
	assert.ok(e.text.length <= 2000);
	assert.equal(toolArg({ command: "ls\n  -la   /tmp" }), "ls -la /tmp");
	assert.equal(toolArg({ path: "a/b.ts" }), "a/b.ts");
	assert.ok(toolArg({ command: "x".repeat(500) }).length <= 120);
});

// ---- loop: events, notes, pause gate ----

function gitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "cockpit-loop-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@t");
	git("config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "x\n");
	git("add", "-A");
	git("commit", "-qm", "init");
	return dir;
}

const DOC = "Contenuto concreto del documento di progetto, abbastanza lungo da contare come scritto.\n";
const PLAN = JSON.stringify({ requisiti: [{ id: "R1", descrizione: "hello.txt dice ciao", check: "grep -q ciao hello.txt", prova: "legge il file" }] });

function script(state: AutoState, request: StepRequest): void {
	const at = (p: string) => join(state.worktree, p);
	if (request.phase === "define") {
		mkdirSync(at("intents"), { recursive: true });
		writeFileSync(at(state.intent), "---\nstatus: in-progress\n---\n# Hello\n\n## Outcome atteso\n- [ ] hello.txt\n");
		mkdirSync(at("docs/progetto"), { recursive: true });
	}
	if (request.phase === "plan") {
		mkdirSync(at("auto"), { recursive: true });
		writeFileSync(at("auto/requisiti.json"), PLAN);
	}
	if (request.phase === "build") writeFileSync(at("hello.txt"), "ciao\n");
}

test("loop: diary events for steps and checks, user note enters the next prompt once, gate runs between steps", async () => {
	const dir = gitRepo();
	const events: DiaryEvent[] = [];
	const prompts: string[] = [];
	let now = 1_000, gates = 0;
	const d: LoopDeps = {
		step: async (state, request) => {
			prompts.push(`${request.phase}:${request.prompt}`);
			script(state, request);
			return { ok: true, text: "fatto", tokens: 100 };
		},
		check: async (command, cwd) => {
			const out = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });
			return { ok: out.status === 0, output: `${out.stdout}${out.stderr}` };
		},
		git: async (cwd, args) => {
			const out = spawnSync("git", args, { cwd, encoding: "utf8" });
			return { ok: out.status === 0, out: `${out.stdout}${out.stderr}` };
		},
		usage: () => undefined,
		now: () => (now += 1000),
		save: () => {},
		stopped: () => false,
		event: (e) => events.push(e),
		gate: async () => void gates++,
	};
	const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
	const state = newState({ goal: "crea hello.txt", slug: "hello", branch: "main", repo: dir, worktree: dir, base, intent: "intents/2026-01-01-hello.md", started: 0, deadline: 10_000_000 });
	state.notes = ["usa il file hello.txt"];
	state.steps = 0;
	await runAuto(state, d);
	assert.ok(gates >= 2, "gate called at every loop turn");
	assert.ok(events.some((e) => e.t === "step"), "step events");
	assert.ok(events.some((e) => e.t === "end" && e.ms > 0), "end events with duration");
	const notes = events.filter((e) => e.t === "cmd" && e.cmd === "nota");
	assert.equal(notes.length, 1, "the note is applied once");
	assert.equal(prompts.filter((p) => p.includes("Nota dell'utente")).length, 1, "the note is in one prompt only");
	assert.deepEqual(state.notes, []);
});

test("withNotes: no note, no change to the prompt", () => {
	const state = newState({ goal: "g", slug: "s", branch: "b", repo: "/r", worktree: "/w", base: "x", intent: "i", started: 0, deadline: 1 });
	const d = { now: () => 1, event() {} } as unknown as LoopDeps;
	assert.equal(withNotes(state, d, "P"), "P");
	state.notes = ["a", "b"];
	const text = withNotes(state, d, "P");
	assert.ok(text.startsWith("P\n\n") && text.includes("- a") && text.includes("- b"));
	assert.equal(withNotes(state, d, "P"), "P");
});

// ---- cockpit view ----

const baseState = (over: Partial<AutoState> = {}): AutoState =>
	newState({ goal: "g", slug: "demo", branch: "auto/demo", repo: "/r", worktree: "/w", base: "x", intent: "i", started: 0, deadline: 3_600_000, ...over });

const reqs = (n: number, done: number) => Array.from({ length: n }, (_, i) => ({ id: `R${i + 1}`, descrizione: `requisito numero ${i + 1}`, check: "true", prova: "p", passes: i < done }));

const evs = (): DiaryEvent[] => [
	{ t: "step", at: 1000, n: 1, phase: "build" },
	{ t: "tool", at: 1100, n: 1, name: "bash", arg: "npm test" },
	{ t: "tool", at: 1200, n: 1, name: "edit", arg: "src/a.ts" },
	{ t: "end", at: 9000, n: 1, ok: true, ms: 8000, tokens: 12000, text: "Ho scritto il modulo e i test." },
	{ t: "check", at: 9100, id: "R1", ok: true },
	{ t: "check", at: 9100, id: "R2", ok: false, out: "AssertionError: atteso 2\nricevuto 3" },
	{ t: "step", at: 10000, n: 2, phase: "build" },
	{ t: "tool", at: 10100, n: 2, name: "read", arg: "src/b.ts" },
];

test("health: PROCEDE, A RISCHIO (stall, 4 build steps without green, time), FERMA, SERVE TE", () => {
	const s = baseState({ requirements: reqs(3, 1), steps: 2 });
	assert.equal(health(s, evs(), 12_000, undefined).word, "PROCEDE");
	assert.equal(health({ ...s, stall: 2 }, evs(), 12_000, undefined).word, "A RISCHIO");
	assert.match(health({ ...s, stall: 2 }, evs(), 12_000, undefined).why, /stallo 2\/3/);
	assert.equal(health(s, evs(), 3_000_000, undefined).word, "A RISCHIO", "time over 80%");
	const four: DiaryEvent[] = [1, 2, 3, 4].map((n) => ({ t: "step", at: n, n, phase: "build" }));
	assert.match(health(s, four, 10, undefined).why, /4 passi build senza/);
	assert.equal(health({ ...s, stop: { reason: "stallo", detail: "3 passi", at: 1 } }, [], 10, undefined).word, "FERMA");
	assert.equal(health({ ...s, stop: { reason: "check-manomessi", detail: "x", at: 1 } }, [], 10, undefined).word, "SERVE TE");
	assert.equal(health({ ...s, paused: true }, [...evs(), { t: "cmd", at: 11_000, cmd: "pausa", applied: true }], 12_000, undefined).word, "FERMA");
	assert.deepEqual(pending({ ...s, paused: true, notes: ["x"] } as AutoState, evs()).list.length, 2);
});

test("groupSteps: tools, end and checks land in their step", () => {
	const g = groupSteps(evs());
	assert.equal(g.length, 2);
	assert.equal(g[0].tools.length, 2);
	assert.equal(g[0].checks.length, 2);
	assert.equal(g[1].end, undefined);
});

test("cockpit 100x30: exact rows, width kept, health, requirements, live step, keys", () => {
	const state = baseState({ requirements: reqs(3, 1), steps: 2, tokens: 12000 });
	const rows = cockpitRows({ state, events: evs(), now: 14_000, W: 100, H: 30, usage: undefined, ui: { sel: -1, top: 0, note: null } });
	assert.equal(rows.length, 30);
	const text = plain(rows);
	assert.ok(text.every((r) => r.length <= 100), "no row wider than the screen");
	const all = text.join("\n");
	assert.match(all, /AUTO demo/);
	assert.match(all, /PROCEDE/);
	assert.match(all, /IN DIRETTA/);
	assert.match(all, /1\/3 requisiti/);
	assert.match(all, /✓ R1/);
	assert.match(all, /▸ R2/);
	assert.match(all, /passo 2 · build/);
	assert.match(all, /read src\/b\.ts/);
	assert.match(text[29], /p pausa · : nota · s stop/);
});

test("cockpit review: previous step with end text and failing check output; new step flagged", () => {
	const state = baseState({ requirements: reqs(3, 1), steps: 2 });
	const rows = plain(cockpitRows({ state, events: evs(), now: 14_000, W: 100, H: 30, usage: undefined, ui: { sel: 0, top: 0, seen: 1, note: null } }));
	const all = rows.join("\n");
	assert.match(all, /RIVEDI passo 1\/2/);
	assert.match(all, /✖ R2/);
	assert.match(all, /atteso 2/);
	assert.match(all, /Ho scritto il modulo/);
	assert.match(all, /nuovo passo/);
});

test("cockpit narrow 50x20 and note input; pending line; stopped run", () => {
	const state = baseState({ requirements: reqs(12, 4), steps: 2, notes: ["x"], paused: true });
	const rows = plain(cockpitRows({ state, events: evs(), now: 14_000, W: 50, H: 20, usage: 0.3, ui: { sel: -1, top: 0, note: "usa pnpm" } }));
	assert.equal(rows.length, 20);
	assert.ok(rows.every((r) => r.length <= 50), "narrow rows fit");
	assert.match(rows.join("\n"), /in attesa: pausa al prossimo passo/);
	assert.match(rows[19], /nota › usa pnpm/);
	const done = cockpitRows({ state: baseState({ requirements: reqs(2, 2), stop: { reason: "completato", detail: "ok", at: 5 } }), events: evs(), now: 14_000, W: 100, H: 24, usage: undefined, ui: { sel: -1, top: 0, note: null } });
	assert.match(plain(done).join("\n"), /\/land/);
});

test("feed: reads state and diary incrementally, ignores a half-written line until completed", () => {
	const dir = mkdtempSync(join(tmpdir(), "feed-"));
	const stateFile = join(dir, "demo.json");
	writeFileSync(stateFile, JSON.stringify(baseState()));
	const feed = createFeed(stateFile);
	assert.equal(feed.refresh(), true);
	assert.equal(feed.events.length, 0);
	const line = JSON.stringify({ t: "step", at: 1, n: 1, phase: "build" });
	appendFileSync(feed.diaryPath, `${line}\n${line.slice(0, 10)}`);
	assert.equal(feed.refresh(), true);
	assert.equal(feed.events.length, 1);
	appendFileSync(feed.diaryPath, `${line.slice(10)}\n`);
	assert.equal(feed.refresh(), true);
	assert.equal(feed.events.length, 2);
	assert.equal(feed.refresh(), false, "nothing new: no change");
});
