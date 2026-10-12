/**
 * `parallel`: Pi alone hands 2+ independent parts of a job to agents that run at the same time.
 * Same agents, roles and specialists as the team, none of its ceremony: no plan approval, no baseline,
 * no reviewer, no corrective rounds. Writers must declare disjoint files (checked here, before anything runs);
 * each task's checks run when it finishes and a failure gets one retry with the error.
 */
import { filesOverlap } from "./scope.ts";
import { validatePlan, type TeamPlan, type TeamTask } from "./plan.ts";
import type { Role } from "./roles.ts";

export interface ParallelTask {
	role: string;
	title: string;
	instructions: string;
	files?: string[];
	verify?: string[];
}

export interface ParallelRequest {
	goal: string;
	tasks: ParallelTask[];
}

/** The request as a team plan without dependencies, review or new members: ids p1, p2… */
export function toParallelPlan(request: ParallelRequest): TeamPlan {
	const tasks: TeamTask[] = (request.tasks ?? []).map((task, index) => ({ ...task, id: `p${index + 1}` }));
	return { goal: request.goal, tasks, review: false };
}

export function validateParallel(plan: TeamPlan, roles: Map<string, Role>): string[] {
	const problems = validatePlan(plan, roles).map((problem) => problem.replace("do it yourself without the team (it only pays off with 2+ separable tasks)", "do it yourself (parallel needs 2+ independent tasks)"));
	const writers = plan.tasks.filter((task) => roles.get(task.role)?.writes);
	for (const [index, task] of writers.entries()) {
		for (const other of writers.slice(index + 1)) {
			if (task.files?.length && other.files?.length && filesOverlap(task.files, other.files)) {
				problems.push(`tasks "${task.id}" and "${other.id}" both change ${shared(task.files, other.files)}: writers must have disjoint files (merge them into one task, or run them one after the other)`);
			}
		}
	}
	return problems;
}

function shared(a: string[], b: string[]): string {
	const overlap = a.filter((path) => filesOverlap([path], b));
	return overlap.map((path) => `\`${path}\``).join(", ");
}

/** Short report for the main session: what each agent did, its checks, totals. */
export function renderParallelReport(report: import("./orchestrator.ts").TeamReport): string {
	const done = report.tasks.filter((task) => task.status === "done").length;
	const lines = [`# Parallel: ${done}/${report.tasks.length} compiti completati`];
	for (const task of report.tasks) {
		const checks = task.lastVerify.map((result) => `${result.ok ? "✓" : "✗"} \`${result.command}\``).join(", ");
		lines.push(`- ${task.status === "done" ? "✓" : "✗"} ${task.id} [${task.role}] ${task.title}${task.attempts > 1 ? ` (tentativi ${task.attempts})` : ""}${task.reason ? ` — ${task.reason}` : ""}${checks ? ` · ${checks}` : ""}`);
		if (task.summary) lines.push(`  ${task.summary.replace(/\n/g, "\n  ").slice(0, 800)}`);
		const failed = task.lastVerify.find((result) => !result.ok);
		if (task.status !== "done" && failed) lines.push(`  \`\`\`\n  ${failed.outputTail.slice(-800).replace(/\n/g, "\n  ")}\n  \`\`\``);
	}
	if (report.scopeWarnings.length) lines.push("", `⚠️ File cambiati fuori dai file dichiarati: ${report.scopeWarnings.map((path) => `\`${path}\``).join(", ")}`);
	lines.push("", `Agenti: ${report.totals.agentRuns} · token input ${report.totals.inputTokens}, output ${report.totals.outputTokens} · tempo agenti ${Math.round(report.totals.seconds)}s`);
	return lines.join("\n");
}
