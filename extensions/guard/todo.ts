/**
 * The todo list lives in the `todo` tool results of the session: after a compaction or a resume it is rebuilt from
 * them. A `tools.todo(...)` call made inside a codemode script leaves no such result, so the list came back empty
 * (smartlookup, 2026-10-13: ten tasks lost after a compaction). The guard turns that call down before it runs.
 */
export function todoInsideCodemode(toolName: string, input: unknown): boolean {
	if (toolName !== "codemode") return false;
	const code = typeof input === "string" ? input : (input as { code?: unknown } | undefined)?.code;
	return typeof code === "string" && /\btools\s*(?:\.\s*todo\b|\[\s*["'`]todo["'`]\s*\])/.test(code);
}

export const TODO_REASON =
	"Non chiamare todo dentro codemode: lo stato della lista si ricostruisce dai risultati del tool todo e dentro uno script non vengono salvati, quindi dopo una compattazione la lista risulta vuota. Chiama il tool todo direttamente (una chiamata per azione) e tieni codemode per il resto.";

/** Tools that do work (change files, run things). Reading and searching do not make a todo list stale. */
const WORK_TOOLS = new Set(["edit", "write", "bash", "codemode"]);
const WORK_BEFORE_NUDGE = 5;
const WORK_BETWEEN_NUDGES = 8;

interface TaskLike {
	status?: string;
}

/**
 * Models forget to keep the todo list current unless asked (smartlookup, 2026-10-13: "i todos sono aggiornati?").
 * This counts the work done since the last `todo` call while the list still has open items, and says so: one line
 * added to a tool result (mid-turn) and a hidden reminder when the next message arrives. Costs nothing until it speaks.
 */
export class TodoWatch {
	private open = 0;
	private sinceTodo = 0;
	private lastNudgeAt = 0;
	private remindedAt = -1;

	/** Rebuilds the state from a session branch (resume, reload, compaction). */
	static fromBranch(branch: Iterable<unknown>): TodoWatch {
		const watch = new TodoWatch();
		for (const entry of branch) {
			const message = (entry as { message?: { role?: string; toolName?: string; details?: unknown; isError?: boolean } }).message;
			if (message?.role === "toolResult" && message.toolName) watch.result(message.toolName, message.details, Boolean(message.isError));
		}
		return watch;
	}

	/** Feed every tool result. Returns the line to add to this result, if it is time. */
	result(toolName: string, details: unknown, isError: boolean): string | undefined {
		if (toolName === "todo") {
			const tasks = (details as { tasks?: unknown } | undefined)?.tasks;
			if (!Array.isArray(tasks) || isError) return undefined;
			this.open = (tasks as TaskLike[]).filter((task) => task.status !== "completed" && task.status !== "deleted").length;
			this.sinceTodo = 0;
			this.lastNudgeAt = 0;
			this.remindedAt = -1;
			return undefined;
		}
		if (!WORK_TOOLS.has(toolName)) return undefined;
		this.sinceTodo++;
		if (this.open === 0 || this.sinceTodo < WORK_BEFORE_NUDGE) return undefined;
		if (this.lastNudgeAt && this.sinceTodo - this.lastNudgeAt < WORK_BETWEEN_NUDGES) return undefined;
		this.lastNudgeAt = this.sinceTodo;
		return `[promemoria] ${this.sinceTodo} azioni senza aggiornare i todo (${this.open} ancora aperti): con il tool todo segna completato ciò che è fatto e in_progress ciò che stai facendo.`;
	}

	/** When a new user message arrives: a hidden reminder if the list was left behind, once per state. */
	reminder(): string | undefined {
		if (this.open === 0 || this.sinceTodo < 3 || this.remindedAt === this.sinceTodo) return undefined;
		this.remindedAt = this.sinceTodo;
		return `I todo non sono aggiornati: dall'ultimo aggiornamento hai fatto ${this.sinceTodo} azioni e ${this.open} voci sono ancora aperte. Prima di rispondere aggiorna la lista con il tool todo (completato ciò che è fatto, in_progress ciò che fai ora).`;
	}
}
