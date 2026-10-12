import { test } from "node:test";
import assert from "node:assert/strict";
import { runTeamPlan } from "../src/orchestrator.ts";
import { toParallelPlan, validateParallel } from "../src/parallel.ts";
import { loadRoles } from "../src/roles.ts";
import type { AgentRun } from "../src/runner.ts";

const roles = loadRoles();
const instructions = "Aggiungi la funzione richiesta e il suo test nel modulo";
const ok = (text: string): AgentRun => ({ ok: true, text, inputTokens: 1, outputTokens: 1, requests: 1, seconds: 0 });

test("validateParallel: writers need disjoint declared files, readers may look at anything", () => {
	const writer = (files?: string[]) => ({ role: "implementer", title: "w", instructions, files, verify: ["true"] });
	assert.deepEqual(validateParallel(toParallelPlan({ goal: "g", tasks: [writer(["a.js"]), writer(["b.js", "test/"])] }), roles), []);
	assert.match(validateParallel(toParallelPlan({ goal: "g", tasks: [writer(["src/"]), writer(["src/a.js"])] }), roles).join(), /disjoint files/);
	assert.match(validateParallel(toParallelPlan({ goal: "g", tasks: [writer(["a.js"]), writer()] }), roles).join(), /declares no `files`/);
	const reader = { role: "scout", title: "r", instructions };
	assert.deepEqual(validateParallel(toParallelPlan({ goal: "g", tasks: [reader, reader] }), roles), []);
	assert.match(validateParallel(toParallelPlan({ goal: "g", tasks: [reader] }), roles).join(), /parallel needs 2\+ independent tasks/);
	assert.match(validateParallel(toParallelPlan({ goal: "g", tasks: [writer(["a.js"]), { ...writer(["b.js"]), role: "react-dev" }] }), roles).join(), /^$/, "specialists are writers too");
});

test("a light run: no baseline checks, no reviewer, one retry with the error, all agents at once", async () => {
	const plan = toParallelPlan({ goal: "g", tasks: ["a", "b", "c"].map((name) => ({ role: "implementer", title: name, instructions, files: [`${name}.js`], verify: [`check-${name}`] })) });
	const verifyCalls: string[] = [];
	const prompts: string[] = [];
	let active = 0;
	let most = 0;
	const report = await runTeamPlan(plan, {
		roles,
		cwd: "/tmp",
		concurrency: 8,
		light: true,
		snapshotFiles: async () => new Map(),
		runAgent: async (request) => {
			prompts.push(request.prompt);
			most = Math.max(most, ++active);
			await new Promise((resolve) => setTimeout(resolve, 10));
			active--;
			return ok("## Risultati\nfatto");
		},
		runVerify: async (commands) => {
			verifyCalls.push(...commands);
			return commands.map((command) => {
				// check-b fails for real (also on a quiet tree) until the agent got the error back.
				const passed = !(command === "check-b" && !prompts.some((prompt) => /tentativo precedente/.test(prompt)));
				return { command, ok: passed, exitCode: passed ? 0 : 1, outputTail: passed ? "" : "boom", seconds: 0 };
			});
		},
	});
	assert.equal(most, 3);
	assert.equal(verifyCalls.filter((command) => command === "check-a").length, 1, "no baseline, no final run of every check");
	assert.equal(verifyCalls.filter((command) => command === "check-c").length, 1);
	assert.equal(prompts.length, 4, "3 agents + 1 retry, no reviewer");
	assert.ok(prompts.some((prompt) => /tentativo precedente non riuscito[\s\S]*boom/.test(prompt)));
	assert.deepEqual(report.tasks.map((task) => task.status), ["done", "done", "done"]);
});
