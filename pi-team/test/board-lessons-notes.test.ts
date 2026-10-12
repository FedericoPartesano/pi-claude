import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardStatus, createBoard, renderBoard, shortError, type TeamBoard } from "../src/board.ts";
import { deriveLessons, formatLessons, lessonsFile, loadLessons, saveLessons } from "../src/lessons.ts";
import { createNotes, notesInstructions } from "../src/notes.ts";
import { runTeamPlan, type TaskOutcome, type TeamReport } from "../src/orchestrator.ts";
import type { TeamPlan } from "../src/plan.ts";
import type { Role } from "../src/roles.ts";
import type { AgentRun } from "../src/runner.ts";
import { TEAM_REQUEST } from "../index.ts";

const role = (name: string, writes: boolean): Role => ({ name, description: "", model: "sonnet", thinking: "medium", tools: [], writes, instructions: "" });
const roles = new Map(["scout", "implementer", "reviewer"].map((name) => [name, role(name, name === "implementer")]));
const ok = (text: string): AgentRun => ({ ok: true, text, inputTokens: 10, outputTokens: 2, requests: 1, seconds: 1 });

test("board status: done/total, failures, the active task and its attempt", () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "scout", title: "a", instructions: "" }, { id: "t2", role: "implementer", title: "b", instructions: "" }] };
	const board = createBoard(plan, roles, 0);
	assert.equal(boardStatus(board), "team 0/2 · controlli iniziali");
	board.phase = "tasks";
	board.tasks[0].state = "done";
	Object.assign(board.tasks[1], { state: "running", attempts: 2 });
	assert.equal(boardStatus(board), "team 1/2 · t2 implementer (2° tentativo)");
	board.tasks[1].state = "failed";
	board.phase = "done";
	assert.equal(boardStatus(board), "team 1/2 ✗1 · fine");
	assert.match(renderBoard(board), /✓ t1 \[scout\] a\n✗ t2 \[implementer\] b · tentativo 2/);
});

test("shortError picks the line that says what failed", () => {
	assert.equal(shortError("> test\n\nnot ok 1 - adds\n  expected 3"), "not ok 1 - adds");
	assert.equal(shortError("solo testo"), "solo testo");
	assert.equal(shortError(`Error: ${"x".repeat(300)}`).length, 160);
});

test("the orchestrator publishes the board at every transition, ending with the outcome", async () => {
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "t1", role: "scout", title: "esplora", instructions: "x" },
			{ id: "t2", role: "implementer", title: "scrive", instructions: "y", dependsOn: ["t1"], verify: ["npm test"], files: ["a.js"] },
		],
		review: false,
	};
	const boards: TeamBoard[] = [];
	let verifyCalls = 0;
	const report = await runTeamPlan(plan, {
		roles,
		cwd: "/tmp",
		concurrency: 2,
		runAgent: async (request) => ok(`## Risultati\nfatto ${request.role.name}`),
		// Baseline passes, the first task check fails once, then everything passes.
		runVerify: async (commands) => commands.map((command) => {
			const passed = verifyCalls++ !== 1;
			return { command, ok: passed, exitCode: passed ? 0 : 1, outputTail: passed ? "" : "not ok 1 - somma", seconds: 0 };
		}),
		onBoard: (board) => boards.push(board),
	});
	assert.equal(report.outcome, "verified");
	const states = (id: string) => [...new Set(boards.map((board) => board.tasks.find((task) => task.id === id)!.state))];
	assert.deepEqual(states("t2"), ["pending", "running", "verifying", "retry", "done"]);
	assert.deepEqual(report.tasks[1].failures, ["`npm test`: not ok 1 - somma"]);
	const last = boards.at(-1)!;
	assert.equal(last.phase, "done");
	assert.equal(last.outcome, "verified");
	assert.deepEqual(last.finalChecks, [{ command: "npm test", ok: true }]);
	assert.equal(last.tasks[1].attempts, 2);
	assert.match(last.tasks[1].summary ?? "", /fatto implementer/);
	assert.ok(boards.every((board, index) => index === 0 || board !== boards[index - 1]), "snapshots, not the live object");
});

test("shared notes: finished tasks are written there and agents are told where to read", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-team-notes-"));
	const notes = await createNotes("obiettivo", directory);
	const prompts: string[] = [];
	const plan: TeamPlan = {
		goal: "obiettivo",
		tasks: [
			{ id: "t1", role: "scout", title: "esplora", instructions: "x" },
			{ id: "t2", role: "scout", title: "altro", instructions: "y", dependsOn: ["t1"] },
		],
		review: false,
	};
	await runTeamPlan(plan, {
		roles,
		cwd: "/tmp",
		concurrency: 1,
		notes,
		lessons: "Lezioni dai lavori precedenti del team in questo progetto:\n- usa node --test",
		runAgent: async (request) => {
			prompts.push(request.prompt);
			return ok(`## Risultati\nscoperta di ${request.prompt.includes("(t1)") ? "t1" : "t2"}`);
		},
		runVerify: async () => [],
	});
	const text = readFileSync(notes.path, "utf8");
	assert.match(text, /Obiettivo: obiettivo/);
	assert.match(text, /## t1 \(scout\) esplora\nscoperta di t1/);
	assert.match(text, /## t2 \(scout\) altro\nscoperta di t2/);
	assert.ok(prompts.every((prompt) => prompt.includes(notes.path)), "every agent knows the notes file");
	assert.ok(prompts.every((prompt) => prompt.includes("usa node --test")), "every agent sees the lessons");
	assert.match(notesInstructions(notes.path), />> /);
});

const outcome = (overrides: Partial<TaskOutcome>): TaskOutcome => ({ id: "t1", role: "implementer", title: "carrello", status: "done", attempts: 1, summary: "", lastVerify: [], runs: [], failures: [], ...overrides });
const report = (overrides: Partial<TeamReport>): TeamReport => ({
	goal: "g", tasks: [], finalVerify: [], finalOk: true, review: { verdict: "approved", notes: "" }, fixRounds: 0, preexistingFailures: [], scopeWarnings: [],
	outcome: "verified", totals: { agentRuns: 0, inputTokens: 0, outputTokens: 0, seconds: 0 }, board: createBoard({ goal: "g", tasks: [] }, roles), ...overrides,
});

test("lessons come from what went wrong, and a fixed check cancels its lesson", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-team-lessons-"));
	const file = join(directory, "p.jsonl");
	const first = deriveLessons(report({
		tasks: [
			outcome({ attempts: 2, failures: ["`npm test`: not ok 1 - somma"] }),
			outcome({ id: "t2", title: "fattura", status: "failed", attempts: 3, failures: ["a", "b", "`npm test`: boom"], runs: [{ ...ok(""), ok: false, error: "budget di token del ruolo superato" }] }),
			outcome({ id: "t3", title: "saltato", status: "skipped" }),
		],
		preexistingFailures: ["npm run lint"],
		review: { verdict: "changes", notes: "- manca il caso qty 0" },
		scopeWarnings: ["data/x.md"],
	}), new Date("2026-10-01"));
	assert.deepEqual(first.map((lesson) => lesson.kind).sort(), ["budget", "failed", "preexisting", "retry", "review", "scope"]);
	saveLessons("/progetto", first, file);
	assert.equal(loadLessons("/progetto", file).length, 6);

	// Later the lint check passes: its lesson disappears, the others stay.
	const later = deriveLessons(report({ preexistingFailures: ["npm run lint"], finalVerify: [{ command: "npm run lint", ok: true, exitCode: 0, outputTail: "", seconds: 0 }] }), new Date("2026-10-02"));
	assert.deepEqual(later.map((lesson) => lesson.kind), ["fixed"]);
	saveLessons("/progetto", later, file);
	const current = loadLessons("/progetto", file);
	assert.equal(current.length, 5);
	assert.ok(!current.some((lesson) => lesson.key === "pre:npm run lint"));
	const text = formatLessons(current, 3);
	assert.match(text, /^Lezioni dai lavori precedenti/);
	assert.equal(text.split("\n").length, 4);
	assert.equal(formatLessons([]), "");
	assert.equal(deriveLessons(report({})).length, 0, "a clean run teaches nothing");
});

test("lessons file is per project and survives a missing directory", () => {
	assert.notEqual(lessonsFile("/a/shop"), lessonsFile("/b/shop"));
	assert.match(lessonsFile("/a/shop"), /shop-[0-9a-f]{10}\.jsonl$/);
	const directory = join(mkdtempSync(join(tmpdir(), "pi-team-lessons-")), "nested");
	assert.deepEqual(loadLessons("/x", join(directory, "x.jsonl")), []);
	saveLessons("/x", [{ at: "2026-10-01", kind: "retry", key: "k", text: "t" }], join(directory, "x.jsonl"));
	assert.ok(existsSync(join(directory, "x.jsonl")));
});

test("team requests the manager guard reacts to", () => {
	for (const text of ["Usa il tool team per questo lavoro.", "usa il team per rifare il carrello", "use the team", "Utilizza team"]) assert.ok(TEAM_REQUEST.test(text), text);
	for (const text of ["il team di marketing vuole un report", "steam deck", "con il team"]) assert.ok(!TEAM_REQUEST.test(text), text);
});
