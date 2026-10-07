/**
 * The team plan written by the manager model, its validation and its text rendering.
 */
import type { Role } from "./roles.ts";

export interface TeamTask {
	id: string;
	role: string;
	title: string;
	instructions: string;
	dependsOn?: string[];
	/** Files (or folders ending with "/") the task may change: writers with disjoint files run in parallel. */
	files?: string[];
	/** Shell commands that must succeed after the task (run by code, not by the agent). */
	verify?: string[];
}

export interface TeamPlan {
	goal: string;
	tasks: TeamTask[];
	/** Shell commands that must succeed on the final result. */
	finalVerify?: string[];
	/** Ask the reviewer role to check the overall change. Default true. */
	review?: boolean;
}

/** Returns the list of problems; empty when the plan can run. */
export function validatePlan(plan: TeamPlan, roles: Map<string, Role>): string[] {
	const problems: string[] = [];
	if (!plan.goal?.trim()) problems.push("goal is empty");
	if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) return [...problems, "tasks is empty"];
	// One task means one agent doing what the manager could do itself, plus the team's overhead (~3×).
	if (plan.tasks.length === 1) return [...problems, "the plan has one task: do it yourself without the team (it only pays off with 2+ separable tasks)"];

	const ids = new Set<string>();
	for (const task of plan.tasks) {
		if (!task.id?.trim()) problems.push(`a task has no id (${task.title ?? "untitled"})`);
		else if (ids.has(task.id)) problems.push(`duplicate task id "${task.id}"`);
		ids.add(task.id);
		const role = roles.get(task.role);
		if (!role) problems.push(`task "${task.id}": unknown role "${task.role}" (available: ${[...roles.keys()].join(", ")})`);
		if (!task.instructions?.trim()) problems.push(`task "${task.id}": instructions are empty`);
		if (role?.writes && !(task.verify?.length || plan.finalVerify?.length)) {
			problems.push(`task "${task.id}" (${task.role}) changes files but has no verify command and the plan has no finalVerify`);
		}
	}
	for (const task of plan.tasks) {
		for (const dependency of task.dependsOn ?? []) {
			if (!ids.has(dependency)) problems.push(`task "${task.id}" depends on unknown task "${dependency}"`);
			if (dependency === task.id) problems.push(`task "${task.id}" depends on itself`);
		}
	}
	if (problems.length === 0) {
		const cycle = findCycle(plan.tasks);
		if (cycle) problems.push(`dependency cycle: ${cycle.join(" → ")}`);
	}
	return problems;
}

function findCycle(tasks: TeamTask[]): string[] | undefined {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const state = new Map<string, "visiting" | "done">();
	const path: string[] = [];
	const visit = (id: string): string[] | undefined => {
		if (state.get(id) === "done") return undefined;
		if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
		state.set(id, "visiting");
		path.push(id);
		for (const dependency of byId.get(id)?.dependsOn ?? []) {
			const cycle = visit(dependency);
			if (cycle) return cycle;
		}
		path.pop();
		state.set(id, "done");
		return undefined;
	};
	for (const task of tasks) {
		const cycle = visit(task.id);
		if (cycle) return cycle;
	}
	return undefined;
}

export function renderPlan(plan: TeamPlan, roles: Map<string, Role>): string {
	const lines = [`Obiettivo: ${plan.goal}`, ""];
	for (const task of plan.tasks) {
		const role = roles.get(task.role);
		const dependencies = task.dependsOn?.length ? ` ← ${task.dependsOn.join(", ")}` : "";
		lines.push(`${task.id} [${task.role} · ${role?.model ?? "?"}] ${task.title}${dependencies}`);
		for (const command of task.verify ?? []) lines.push(`    verifica: ${command}`);
	}
	if (plan.finalVerify?.length) lines.push("", `Verifica finale: ${plan.finalVerify.join(" && ")}`);
	lines.push(`Revisore: ${plan.review === false ? "no" : "sì"}`);
	return lines.join("\n");
}
