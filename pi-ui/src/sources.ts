/** Data for the panel from other extensions, read without importing them: the todo plan and the active intent. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PlanTask {
	subject: string;
	status: string;
}

/** The todo tool's (rpiv-todo) result details → its tasks, deleted ones out; undefined if not that shape. */
export function planFromDetails(details: unknown): PlanTask[] | undefined {
	const value = details as { tasks?: unknown; nextId?: unknown } | undefined;
	if (!value || !Array.isArray(value.tasks) || typeof value.nextId !== "number") return undefined;
	return (value.tasks as { subject?: unknown; status?: unknown }[])
		.filter((task) => task.status !== "deleted")
		.map((task) => ({ subject: String(task.subject ?? ""), status: String(task.status ?? "pending") }));
}

/** The last todo result on the session branch (resumed sessions). */
export function planFromBranch(entries: Iterable<unknown>): PlanTask[] | undefined {
	let plan: PlanTask[] | undefined;
	for (const entry of entries) {
		const message = (entry as { type?: string; message?: { role?: string; toolName?: string; details?: unknown } }).message;
		if ((entry as { type?: string }).type !== "message" || message?.role !== "toolResult" || message.toolName !== "todo") continue;
		plan = planFromDetails(message.details) ?? plan;
	}
	return plan;
}

/** The project's in-progress intent (intents/*.md, newest first): title and the "Outcome atteso" bullets. */
export function activeIntent(cwd: string): { file: string; title: string; outcomes: string[] } | undefined {
	let names: string[];
	try {
		names = readdirSync(join(cwd, "intents")).filter((name) => name.endsWith(".md")).sort().reverse();
	} catch {
		return undefined;
	}
	for (const name of names) {
		const text = readFileSync(join(cwd, "intents", name), "utf8");
		if (!/^status:\s*in-progress\s*$/m.test(text)) continue;
		const title = (/^#\s+(.+)$/m.exec(text)?.[1] ?? name).replace(/^intent:\s*/i, "").trim();
		const section = /^##\s+Outcome atteso\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text)?.[1] ?? "";
		const outcomes = section.split("\n").map((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim()).filter((line): line is string => Boolean(line));
		return { file: `intents/${name}`, title, outcomes };
	}
	return undefined;
}
