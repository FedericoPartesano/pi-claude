/**
 * Auto mode × pi-team: a build step that keeps failing (or is declared big) is handed to the team instead of a
 * single child. Decided by code, no prompt. The team is one implementer plus the reviewer, with the requirement's
 * frozen check as its verification; every team agent runs with the same guard as an auto child (denylist,
 * sandbox, frozen files: auto-worker.ts) because the runner is given the child's args and env.
 *
 *   PI_AUTO_TEAM=off      never
 *   PI_AUTO_TEAM=always   every build step
 *   (default)             from the 2nd failure in a row of the same requirement
 */
import { loadRoles } from "../../pi-team/src/roles.ts";
import { runAgent, type RunAgent } from "../../pi-team/src/runner.ts";
import { runTeamPlan, type TeamReport } from "../../pi-team/src/orchestrator.ts";
import type { VerifyResult } from "../../pi-team/src/verify.ts";
import type { LoopDeps, StepRequest, StepResult } from "./loop.ts";
import { childEnv, runChild, PROVIDER_PATH, WORKER_PATH, type ChildEnv } from "./child.ts";
import type { AutoState } from "./state.ts";

export const TEAM_AFTER_FAILURES = 2;

export function shouldDelegate(request: StepRequest, mode = process.env.PI_AUTO_TEAM ?? ""): boolean {
	if (request.phase !== "build" || !request.requirement || mode === "off") return false;
	return mode === "always" || request.requirement.failures >= TEAM_AFTER_FAILURES;
}

export interface TeamDeps {
	runAgent: RunAgent;
	roles: ReturnType<typeof loadRoles>;
	/** The supervisor's own sandboxed check, so the team verifies exactly what the loop will verify. */
	check: (command: string, cwd: string) => Promise<{ ok: boolean; output: string }>;
}

export function teamPlanFor(state: AutoState, request: StepRequest) {
	const req = request.requirement!;
	return {
		goal: `${state.goal} — requisito ${req.id}`,
		tasks: [{ id: "t1", role: "implementer", title: `Requisito ${req.id}`, instructions: request.prompt, verify: [req.check] }],
		finalVerify: [req.check],
		review: true,
	};
}

/** One team round for the step. Tokens are the team's total; ok only when the frozen check passes. */
export async function teamStep(state: AutoState, request: StepRequest, env: ChildEnv, deps: TeamDeps, signal?: AbortSignal): Promise<StepResult> {
	const guard = ["--no-extensions", "-e", PROVIDER_PATH, "-e", WORKER_PATH];
	const guarded: RunAgent = (agent) => deps.runAgent({ ...agent, extraArgs: guard, env: childEnv(state, request, env), signal });
	let report: TeamReport;
	try {
		report = await runTeamPlan(teamPlanFor(state, request), {
			roles: deps.roles,
			cwd: state.worktree,
			concurrency: 1,
			signal,
			runAgent: guarded,
			runVerify: async (commands, cwd): Promise<VerifyResult[]> => {
				const results: VerifyResult[] = [];
				for (const command of commands) {
					const started = Date.now();
					const r = await deps.check(command, cwd);
					results.push({ command, ok: r.ok, exitCode: r.ok ? 0 : 1, outputTail: r.output.slice(-2000), seconds: (Date.now() - started) / 1000 });
					if (!r.ok) break;
				}
				return results;
			},
			light: true,
		});
	} catch (error) {
		return { ok: false, text: "", tokens: 0, error: `team: ${(error as Error).message}` };
	}
	const tokens = report.totals.inputTokens + report.totals.outputTokens;
	const ok = report.outcome !== "failed";
	return { ok, text: `team (${report.totals.agentRuns} agenti, revisione ${report.review.verdict}): ${report.tasks.map((t) => t.summary).join("\n").slice(-600)}`, tokens, ...(ok ? {} : { error: `team: ${report.tasks.find((t) => t.status !== "done")?.failures.slice(-1)[0] ?? "controllo non passato"}` }) };
}

/** The loop's `step`: one child per step, or the team for the steps `shouldDelegate` picks. */
export function stepWithTeam(env: ChildEnv, check: TeamDeps["check"], signal: AbortSignal): LoopDeps["step"] {
	return (state, request) =>
		shouldDelegate(request) ? teamStep(state, request, env, { runAgent, roles: loadRoles(), check }, signal) : runChild(state, request, env, signal);
}
