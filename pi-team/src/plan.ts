/**
 * The team plan written by the manager model, its validation and its text rendering.
 */
import { validateNewRoles, withNewRoles, type NewRoleSpec } from "./recruit.ts";
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
	/**
	 * Interfaces the tasks share, fixed by the manager before they start (exports and signatures, data formats,
	 * names): every agent gets them, so agents working at the same time agree without asking or waiting.
	 */
	contracts?: string;
	/** Specialists to add to the team (saved for future runs once the plan is approved). */
	newRoles?: NewRoleSpec[];
}

/** Beyond this the coordination costs more than the split saves: group related parts into one task. */
export const MAX_TASKS = 12;
/** Agents see only their instructions (plus the goal and dependencies): a few words are never enough. */
export const MIN_INSTRUCTION_CHARS = 30;

/** Returns the list of problems; empty when the plan can run. */
export function validatePlan(plan: TeamPlan, existingRoles: Map<string, Role>): string[] {
	const problems: string[] = validateNewRoles(plan.newRoles, existingRoles);
	const roles = withNewRoles(existingRoles, plan.newRoles);
	if (!plan.goal?.trim()) problems.push("goal is empty");
	if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) return [...problems, "tasks is empty"];
	// One task means one agent doing what the manager could do itself, plus the team's overhead (~3×).
	if (plan.tasks.length === 1) return [...problems, "the plan has one task: do it yourself without the team (it only pays off with 2+ separable tasks)"];
	if (plan.tasks.length > MAX_TASKS) problems.push(`the plan has ${plan.tasks.length} tasks (max ${MAX_TASKS}): merge closely related parts into one task`);

	const ids = new Set<string>();
	for (const task of plan.tasks) {
		if (!task.id?.trim()) problems.push(`a task has no id (${task.title ?? "untitled"})`);
		else if (ids.has(task.id)) problems.push(`duplicate task id "${task.id}"`);
		ids.add(task.id);
		const role = roles.get(task.role);
		if (!role) problems.push(`task "${task.id}": unknown role "${task.role}" (available: ${[...roles.keys()].join(", ")})`);
		if (!task.instructions?.trim()) problems.push(`task "${task.id}": instructions are empty`);
		else if (task.instructions.trim().length < MIN_INSTRUCTION_CHARS) {
			problems.push(`task "${task.id}": instructions are too short to be self-contained (the agent sees only them, the goal and its dependencies' results): say what to do, where and when it is done`);
		}
		if (role?.writes && !task.files?.length) {
			problems.push(`task "${task.id}" (${task.role}) changes files but declares no \`files\`: list the files or folders (ending with /) it may change`);
		}
		if (role?.writes && !(task.verify?.length || plan.finalVerify?.length)) {
			problems.push(`task "${task.id}" (${task.role}) changes files but has no verify command and the plan has no finalVerify`);
		}
	}
	const dependencyProblems: string[] = [];
	for (const task of plan.tasks) {
		for (const dependency of task.dependsOn ?? []) {
			if (!ids.has(dependency)) dependencyProblems.push(`task "${task.id}" depends on unknown task "${dependency}"`);
			if (dependency === task.id) dependencyProblems.push(`task "${task.id}" depends on itself`);
		}
	}
	problems.push(...dependencyProblems);
	// Cycles are only meaningful when ids are unique and every dependency exists.
	if (dependencyProblems.length === 0 && ids.size === plan.tasks.length) {
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

export function renderPlan(plan: TeamPlan, existingRoles: Map<string, Role>): string {
	const roles = withNewRoles(existingRoles, plan.newRoles);
	const lines = [`Obiettivo: ${plan.goal}`, ""];
	if (plan.newRoles?.length) {
		lines.push("Nuovi membri del team (restano per i lavori futuri, in ~/.pi/agent/team/roles/):");
		for (const spec of plan.newRoles) lines.push(`  + ${spec.name} (${spec.extends}${spec.stack?.length ? ` · ${spec.stack.join(", ")}` : ""}): ${spec.description}`);
		lines.push("");
	}
	for (const task of plan.tasks) {
		const role = roles.get(task.role);
		const dependencies = task.dependsOn?.length ? ` ← ${task.dependsOn.join(", ")}` : "";
		lines.push(`${task.id} [${task.role} · ${role?.model ?? "?"}] ${task.title}${dependencies}`);
		if (task.files?.length) lines.push(`    file: ${task.files.join(", ")}`);
		for (const command of task.verify ?? []) lines.push(`    verifica: ${command}`);
	}
	if (plan.finalVerify?.length) lines.push("", `Verifica finale: ${plan.finalVerify.join(" && ")}`);
	lines.push(`Revisore: ${plan.review === false ? "no" : "sì"}`);
	return lines.join("\n");
}
