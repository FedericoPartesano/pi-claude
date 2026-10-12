import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, runTeamPlan, type OrchestratorDependencies } from "../src/orchestrator.ts";
import type { TeamPlan } from "../src/plan.ts";
import type { Role } from "../src/roles.ts";
import type { AgentRequest, AgentRun } from "../src/runner.ts";

const role = (name: string, writes: boolean): Role => ({ name, description: "", model: "sonnet", thinking: "medium", tools: [], writes, instructions: "" });
const roles = new Map(["scout", "implementer", "tester", "reviewer"].map((name) => [name, role(name, name === "implementer" || name === "tester")]));
const ok = (text: string): AgentRun => ({ ok: true, text, inputTokens: 10, outputTokens: 2, requests: 1, seconds: 1 });

/** Fake team: records an event log; agents "write" the files given by `writes` into a fake working tree. */
function harness(options: { writes?: (request: AgentRequest) => string[]; verifyFails?: (command: string, call: number) => boolean; delay?: (id: string) => number } = {}) {
	const events: string[] = [];
	const tree = new Map<string, string>();
	let version = 0;
	let active = 0;
	let maxWriters = 0;
	let verifyCalls = 0;
	const dependencies: OrchestratorDependencies = {
		roles,
		cwd: "/tmp",
		concurrency: 3,
		snapshotFiles: async () => new Map(tree),
		runAgent: async (request) => {
			const id = /\((t\d+)\)/.exec(request.prompt)?.[1] ?? request.role.name;
			if (request.role.writes) maxWriters = Math.max(maxWriters, ++active);
			events.push(`start ${id}`);
			await new Promise((resolve) => setTimeout(resolve, options.delay?.(id) ?? 10));
			for (const path of options.writes?.(request) ?? []) tree.set(path, String(++version));
			events.push(`end ${id}`);
			if (request.role.writes) active--;
			return ok(request.role.name === "reviewer" ? "VERDETTO: APPROVATO" : "## Risultati\nok");
		},
		runVerify: async (commands) => {
			events.push(`verify ${commands.join(",")}`);
			const call = verifyCalls++;
			return commands.map((command) => {
				const passed = !options.verifyFails?.(command, call);
				return { command, ok: passed, exitCode: passed ? 0 : 1, outputTail: passed ? "" : "boom", seconds: 0 };
			});
		},
	};
	return { dependencies, events, stats: () => ({ maxWriters }) };
}

const writer = (id: string, files?: string[]) => ({ id, role: "implementer", title: id, instructions: "y", files, verify: [`check-${id}`] });

test("writers with disjoint files run at the same time", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["src/a.js"]), writer("t2", ["src/b.js", "test/"])], review: false };
	const { dependencies, stats } = harness();
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(stats().maxWriters, 2);
	assert.equal(report.outcome, "verified");
});

test("writers with overlapping files, or without files, run one at a time", async () => {
	for (const tasks of [[writer("t1", ["src/"]), writer("t2", ["src/b.js"])], [writer("t1", ["src/a.js"]), writer("t2")]]) {
		const { dependencies, stats } = harness();
		await runTeamPlan({ goal: "g", tasks, review: false }, dependencies);
		assert.equal(stats().maxWriters, 1);
	}
});

test("no waves: a writer starts as soon as its dependency is done, while a slow writer is still working", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"]), { ...writer("t3", ["c.js"]), dependsOn: ["t2"] }], review: false };
	const { dependencies, events } = harness({ delay: (id) => (id === "t1" ? 80 : 5) });
	const report = await runTeamPlan(plan, dependencies);
	assert.ok(events.indexOf("start t3") < events.indexOf("end t1"), events.join(" | "));
	assert.equal(report.outcome, "verified");
});

test("a check that fails while another writer is editing runs again when it stops, and is not a failed attempt", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])], review: false };
	let t2Ended = false;
	const { dependencies, events } = harness({
		delay: (id) => (id === "t2" ? 60 : 5),
		// check-t1 fails while t2 is still editing (another agent's half-done work), passes once t2 is done.
		verifyFails: (command, call) => call >= 2 && command === "check-t1" && !t2Ended,
		writes: (request) => (request.prompt.includes("(t2)") && (t2Ended = true), []),
	});
	const report = await runTeamPlan(plan, dependencies);
	assert.deepEqual(report.tasks.map((task) => [task.id, task.status, task.attempts]), [["t1", "done", 1], ["t2", "done", 1]]);
	const checks = events.map((event, index) => [event, index] as const).filter(([event]) => event === "verify check-t1").map(([, index]) => index);
	assert.ok(checks.at(-1)! > events.indexOf("end t2"), events.join(" | "));
});

test("the concurrency limit is read at every step: lowering it mid-run stops new agents", async () => {
	const plan: TeamPlan = { goal: "g", tasks: ["t1", "t2", "t3", "t4"].map((id) => writer(id, [`${id}.js`])), review: false };
	const { dependencies, stats } = harness();
	let calls = 0;
	dependencies.concurrency = () => (++calls <= 2 ? 3 : 1);
	await runTeamPlan(plan, dependencies);
	assert.ok(stats().maxWriters <= 3);
	const { dependencies: one, stats: oneStats } = harness();
	one.concurrency = () => 1;
	await runTeamPlan(plan, one);
	assert.equal(oneStats().maxWriters, 1);
});

test("a failed check is retried with its error, the other task stays done", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])], review: false };
	let failedOnce = false;
	const { dependencies } = harness({ verifyFails: (command, call) => call >= 2 && command === "check-t2" && !failedOnce && (failedOnce = true) }); // calls 0-1: baseline
	const report = await runTeamPlan(plan, dependencies);
	assert.deepEqual(report.tasks.map((task) => [task.id, task.status, task.attempts]), [["t1", "done", 1], ["t2", "done", 2]]);
});

test("changes outside every declared file are reported as a warning when writers ran in parallel", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])], review: false };
	const { dependencies } = harness({ writes: (request) => (request.prompt.includes("(t1)") ? ["a.js", "package.json"] : ["b.js"]) });
	const report = await runTeamPlan(plan, dependencies);
	assert.deepEqual(report.scopeWarnings, ["package.json"]);
	assert.match(renderReport(report), /fuori dai file dichiarati[\s\S]*package\.json/);
});

test("parallel writers are told to touch only their files", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])], review: false };
	const prompts: string[] = [];
	const { dependencies } = harness({ writes: (request) => (prompts.push(request.prompt), []) });
	await runTeamPlan(plan, dependencies);
	assert.ok(prompts.every((prompt) => /SOLO questi file/.test(prompt)), prompts.join("\n---\n"));
});

test("orchestrator: the plan's contracts reach every task prompt", async () => {
	const prompts: string[] = [];
	await runTeamPlan({
		goal: "g",
		review: false,
		tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])],
		contracts: "cart.js esporta addToCart(cart, sku, qty) -> cart",
	}, {
		roles,
		cwd: "/tmp",
		concurrency: 2,
		runAgent: async (request) => {
			prompts.push(request.prompt);
			return ok("## Risultati\nok");
		},
		runVerify: async (commands) => commands.map((command) => ({ command, ok: true, exitCode: 0, outputTail: "", seconds: 0 })),
	});
	assert.equal(prompts.length, 2);
	for (const prompt of prompts) assert.match(prompt, /Interfacce concordate[\s\S]*addToCart\(cart, sku, qty\)/);
});
