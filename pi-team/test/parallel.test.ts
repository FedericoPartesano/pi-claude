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
function harness(options: { writes?: (request: AgentRequest) => string[]; verifyFails?: (command: string, call: number) => boolean } = {}) {
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
			await new Promise((resolve) => setTimeout(resolve, 10));
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

test("writers with disjoint files run in the same wave", async () => {
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

test("task checks run only after the whole wave has finished", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])], review: false };
	const { dependencies, events } = harness();
	await runTeamPlan(plan, dependencies);
	const lastAgentEnd = Math.max(events.indexOf("end t1"), events.indexOf("end t2"));
	const firstTaskCheck = events.findIndex((event) => /verify check-t/.test(event) && events.indexOf(event) > 1);
	assert.ok(firstTaskCheck > lastAgentEnd, events.join(" | "));
});

test("a failed check in a wave is retried with its error, the other task stays done", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [writer("t1", ["a.js"]), writer("t2", ["b.js"])], review: false };
	let failedOnce = false;
	const { dependencies } = harness({ verifyFails: (command, call) => call >= 2 && command === "check-t2" && !failedOnce && (failedOnce = true) }); // calls 0-1: baseline
	const report = await runTeamPlan(plan, dependencies);
	assert.deepEqual(report.tasks.map((task) => [task.id, task.status, task.attempts]), [["t1", "done", 1], ["t2", "done", 2]]);
});

test("changes outside every declared file of the wave are reported as a warning", async () => {
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
