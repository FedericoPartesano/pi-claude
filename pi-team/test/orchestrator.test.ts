import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSummary, parseReviewVerdict, renderReport, runTeamPlan, type OrchestratorDependencies } from "../src/orchestrator.ts";
import type { TeamPlan } from "../src/plan.ts";
import type { Role } from "../src/roles.ts";
import type { AgentRequest, AgentRun } from "../src/runner.ts";
import type { VerifyResult } from "../src/verify.ts";

const role = (name: string, writes: boolean): Role => ({ name, description: "", model: "sonnet", thinking: "medium", tools: [], writes, instructions: "" });
const roles = new Map(["scout", "implementer", "tester", "reviewer"].map((name) => [name, role(name, name === "implementer" || name === "tester")]));
const ok = (text: string): AgentRun => ({ ok: true, text, inputTokens: 10, outputTokens: 2, requests: 1, seconds: 1 });
const verifyResult = (command: string, passed: boolean): VerifyResult => ({ command, ok: passed, exitCode: passed ? 0 : 1, outputTail: passed ? "" : "boom", seconds: 0 });

function harness(options: {
	agent?: (request: AgentRequest, callIndex: number) => AgentRun | Promise<AgentRun>;
	verify?: (commands: string[], callIndex: number) => boolean;
	/** Result of the baseline checks run before any agent (default: passing). */
	baseline?: boolean;
	concurrency?: number;
}) {
	const agentCalls: AgentRequest[] = [];
	let verifyCalls = 0;
	let running = 0;
	let maxRunning = 0;
	const dependencies: OrchestratorDependencies = {
		roles,
		cwd: "/tmp",
		concurrency: options.concurrency ?? 3,
		runAgent: async (request) => {
			agentCalls.push(request);
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running--;
			return options.agent ? options.agent(request, agentCalls.length - 1) : ok(`fatto ${request.role.name}\n## Risultati\nok ${request.role.name}`);
		},
		runVerify: async (commands) => {
			if (agentCalls.length === 0) return commands.map((command) => verifyResult(command, options.baseline ?? true));
			const passed = options.verify ? options.verify(commands, verifyCalls) : true;
			verifyCalls++;
			return commands.map((command) => verifyResult(command, passed));
		},
	};
	return { dependencies, agentCalls, stats: () => ({ verifyCalls, maxRunning }) };
}

const reviewerApproves = (request: AgentRequest) =>
	ok(request.role.name === "reviewer" ? "tutto bene\nVERDETTO: APPROVATO" : `lavoro\n## Risultati\nfatto ${request.role.name}`);

test("happy path: tasks run in dependency order, verified, reviewed", async () => {
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "t1", role: "scout", title: "esplora", instructions: "x" },
			{ id: "t2", role: "implementer", title: "implementa", instructions: "y", dependsOn: ["t1"], verify: ["npm test"] },
		],
		finalVerify: ["npm test"],
	};
	const { dependencies, agentCalls } = harness({ agent: reviewerApproves });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.outcome, "verified");
	assert.deepEqual(agentCalls.map((call) => call.role.name), ["scout", "implementer", "reviewer"]);
	assert.match(agentCalls[1].prompt, /fatto scout/, "implementer receives the scout results");
	assert.equal(report.review.verdict, "approved");
});

test("failed verification is retried with the error output, then succeeds", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "fix", instructions: "y", verify: ["npm test"] }], review: false };
	const { dependencies, agentCalls } = harness({ verify: (_commands, callIndex) => callIndex >= 1 });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.tasks[0].status, "done");
	assert.equal(report.tasks[0].attempts, 2);
	assert.match(agentCalls[1].prompt, /npm test.*fallito[\s\S]*boom/);
	assert.equal(report.outcome, "verified");
});

test("task failing all attempts fails, dependents are skipped, outcome failed", async () => {
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "t1", role: "implementer", title: "a", instructions: "y", verify: ["npm test"] },
			{ id: "t2", role: "tester", title: "b", instructions: "y", dependsOn: ["t1"], verify: ["npm test"] },
		],
	};
	const { dependencies, agentCalls } = harness({ verify: () => false });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.tasks[0].status, "failed");
	assert.equal(report.tasks[0].attempts, 3);
	assert.equal(report.tasks[1].status, "skipped");
	assert.equal(report.outcome, "failed");
	assert.equal(agentCalls.length, 3, "no reviewer, no dependent run");
});

test("final verification failure triggers corrective rounds", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "a", instructions: "y" }], finalVerify: ["npm test"], review: false };
	// First final verify fails, second (after one corrective round) passes.
	const { dependencies, agentCalls } = harness({ verify: (_commands, callIndex) => callIndex >= 1 });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.fixRounds, 1);
	assert.equal(report.finalOk, true);
	assert.match(agentCalls[1].prompt, /intervento correttivo/);
});

test("tests decide: reviewer asking for changes after a fix that breaks tests → failed", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "a", instructions: "y" }], finalVerify: ["npm test"] };
	const { dependencies } = harness({
		agent: (request) => ok(request.role.name === "reviewer" ? "VERDETTO: MODIFICHE — gestisci il caso vuoto" : "## Risultati\nok"),
		verify: (_commands, callIndex) => callIndex === 0, // passes before review, fails after the corrective fix
	});
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.review.verdict, "changes");
	assert.equal(report.outcome, "failed");
});

test("reviewer changes applied and tests still green → verified with review notes", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "a", instructions: "y" }], finalVerify: ["npm test"] };
	const { dependencies } = harness({ agent: (request) => ok(request.role.name === "reviewer" ? "VERDETTO: MODIFICHE — rinomina x" : "## Risultati\nok") });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.outcome, "verified_with_review_notes");
	assert.match(report.review.notes, /applicate dopo la revisione/);
});

test("writers never run in parallel, readers do", async () => {
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "w1", role: "implementer", title: "a", instructions: "y", verify: ["t"] },
			{ id: "w2", role: "tester", title: "b", instructions: "y", verify: ["t"] },
			{ id: "r1", role: "scout", title: "c", instructions: "y" },
			{ id: "r2", role: "scout", title: "d", instructions: "y" },
		],
		review: false,
	};
	const writersActive = { now: 0, max: 0 };
	const { dependencies, stats } = harness({
		agent: async (request) => {
			if (request.role.writes) {
				writersActive.now++;
				writersActive.max = Math.max(writersActive.max, writersActive.now);
				await new Promise((resolve) => setTimeout(resolve, 10));
				writersActive.now--;
			}
			return ok("## Risultati\nok");
		},
	});
	await runTeamPlan(plan, dependencies);
	assert.equal(writersActive.max, 1);
	assert.ok(stats().maxRunning >= 2, "readers overlap with a writer");
});

test("agent error counts as a failed attempt", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "scout", title: "a", instructions: "y" }], review: false };
	const { dependencies } = harness({ agent: (_request, callIndex) => (callIndex === 0 ? { ...ok(""), ok: false, error: "crash" } : ok("## Risultati\nok")) });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.tasks[0].status, "done");
	assert.equal(report.tasks[0].attempts, 2);
});

test("extractSummary and parseReviewVerdict", () => {
	assert.equal(extractSummary("bla bla\n## Risultati\n- a\n- b"), "- a\n- b");
	assert.equal(parseReviewVerdict("ok\nVERDETTO: APPROVATO")?.verdict, "approved");
	assert.deepEqual(parseReviewVerdict("x\nVERDETTO: MODIFICHE — sistema y"), { verdict: "changes", notes: "sistema y" });
	assert.equal(parseReviewVerdict("nessun verdetto"), undefined);
});

test("pre-existing failing check is reported as such, not as a regression", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "a", instructions: "y", verify: ["node --test test/new.test.js"] }], finalVerify: ["npm test"], review: false };
	const { dependencies } = harness({ baseline: false, verify: (commands) => commands[0] !== "npm test" });
	const report = await runTeamPlan(plan, dependencies);
	assert.deepEqual(report.preexistingFailures, ["npm test"]);
	assert.equal(report.outcome, "verified_with_preexisting_failures");
});

test("a check that passed before and fails after is a regression", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "a", instructions: "y" }], finalVerify: ["npm test"], review: false };
	const { dependencies } = harness({ baseline: true, verify: () => false });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.outcome, "failed");
});

test("a check that failed before and passes after is reported as fixed by the team", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "a", instructions: "y" }], finalVerify: ["npm test"], review: false };
	const { dependencies } = harness({ baseline: false, verify: () => true });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.outcome, "verified");
	const rendered = renderReport(report);
	assert.match(rendered, /Fallivano prima del team, ora passano: `npm test`/);
	assert.doesNotMatch(rendered, /Già falliti prima del lavoro del team/);
});

test("the reviewer is told which checks were already failing: out of scope, not a change to ask for", async () => {
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "t1", role: "implementer", title: "a", instructions: "y", verify: ["node --test test/new.test.js"] },
			{ id: "t2", role: "tester", title: "b", instructions: "y", dependsOn: ["t1"], verify: ["node --test test/new.test.js"] },
		],
		finalVerify: ["npm test"],
	};
	const { dependencies, agentCalls } = harness({ baseline: false, verify: () => true, agent: reviewerApproves });
	await runTeamPlan(plan, dependencies);
	const reviewPrompt = agentCalls.find((call) => call.role.name === "reviewer")?.prompt ?? "";
	assert.match(reviewPrompt, /già prima[\s\S]*`npm test`[\s\S]*fuori perimetro/);
});

test("crm: every task prompt carries the closing callout protocol", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "scout", title: "esplora", instructions: "x" }] };
	const { dependencies, agentCalls } = harness({ agent: reviewerApproves });
	await runTeamPlan(plan, dependencies);
	assert.match(agentCalls[0].prompt, /STATO: FATTO | DEVIAZIONE.*BLOCCATO/);
});

test("crm: BLOCCATO stops the retries, skips the checks and keeps the reason", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "x", instructions: "y", verify: ["npm test"] }] };
	const { dependencies, agentCalls, stats } = harness({
		agent: (request) => ok(request.role.name === "reviewer" ? "VERDETTO: APPROVATO" : "non posso\nSTATO: BLOCCATO — manca a.ts"),
	});
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.tasks[0].status, "failed");
	assert.equal(report.tasks[0].attempts, 1);
	assert.match(report.tasks[0].reason ?? "", /bloccato: manca a\.ts/);
	assert.equal(agentCalls.filter((call) => call.role.name === "implementer").length, 1);
	assert.equal(stats().verifyCalls, 0);
});

test("crm: DISACCORDO is reported as disagreement, not retried", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "x", instructions: "y" }] };
	const { dependencies } = harness({ agent: () => ok("STATO: DISACCORDO — la funzione esiste già in b.ts") });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.tasks[0].attempts, 1);
	assert.match(report.tasks[0].reason ?? "", /in disaccordo: la funzione esiste già/);
});

test("crm: DEVIAZIONE still completes and stays visible in the summary", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "implementer", title: "x", instructions: "y" }] };
	const { dependencies } = harness({ agent: (request) => ok(request.role.name === "reviewer" ? "VERDETTO: APPROVATO" : "## Risultati\nfatto\nSTATO: DEVIAZIONE — toccato c.ts") });
	const report = await runTeamPlan(plan, dependencies);
	assert.equal(report.tasks[0].status, "done");
	assert.match(report.tasks[0].summary, /^⚠ Deviazione: toccato c\.ts/);
});

test("crm: PI_TEAM_CRM=0 leaves the prompt without the callout block (control arm)", async () => {
	const plan: TeamPlan = { goal: "g", tasks: [{ id: "t1", role: "scout", title: "esplora", instructions: "x" }] };
	process.env.PI_TEAM_CRM = "0";
	try {
		const { dependencies, agentCalls } = harness({ agent: reviewerApproves });
		await runTeamPlan(plan, dependencies);
		assert.doesNotMatch(agentCalls[0].prompt, /STATO:/);
	} finally {
		delete process.env.PI_TEAM_CRM;
	}
});
