/**
 * The team board: a structured snapshot of a running plan (phase, every task's state, checks).
 * The orchestrator updates it at every transition; the tool sends it as `details` so interfaces
 * (pi-desk's team card, the footer status) show the work without parsing progress text.
 */
import type { TeamPlan } from "./plan.ts";
import type { Role } from "./roles.ts";

export type BoardTaskState = "pending" | "running" | "verifying" | "retry" | "done" | "failed" | "skipped";
export type BoardPhase = "baseline" | "tasks" | "final" | "fix" | "review" | "done";

export interface BoardTask {
	id: string;
	role: string;
	model: string;
	title: string;
	dependsOn: string[];
	files: string[];
	state: BoardTaskState;
	attempts: number;
	parallel: boolean;
	/** Last failed check or agent error, short. */
	error?: string;
	/** The agent's "## Risultati", short. */
	summary?: string;
	tokens: number;
	seconds: number;
}

export interface TeamBoard {
	goal: string;
	phase: BoardPhase;
	tasks: BoardTask[];
	finalChecks: { command: string; ok: boolean }[];
	preexisting: string[];
	fixRounds: number;
	review?: string;
	outcome?: string;
	startedAt: number;
	endedAt?: number;
}

export function createBoard(plan: TeamPlan, roles: Map<string, Role>, now = Date.now()): TeamBoard {
	return {
		goal: plan.goal,
		phase: "baseline",
		tasks: plan.tasks.map((task) => ({
			id: task.id,
			role: task.role,
			model: roles.get(task.role)?.model ?? "?",
			title: task.title,
			dependsOn: task.dependsOn ?? [],
			files: task.files ?? [],
			state: "pending",
			attempts: 0,
			parallel: false,
			tokens: 0,
			seconds: 0,
		})),
		finalChecks: [],
		preexisting: [],
		fixRounds: 0,
		startedAt: now,
	};
}

/** First meaningful line of an error output, for a one-line board entry. */
export function shortError(text: string, max = 160): string {
	const line = text.split("\n").map((part) => part.trim()).find((part) => /error|fail|✗|assert|expected|not ok|throw/i.test(part))
		?? text.split("\n").map((part) => part.trim()).find(Boolean)
		?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const PHASE_LABEL: Record<BoardPhase, string> = {
	baseline: "controlli iniziali",
	tasks: "compiti",
	final: "verifica finale",
	fix: "correzione",
	review: "revisione",
	done: "fine",
};

/** One line for the footer: "team 3/6 ✓2 · t4 implementer (2° tentativo)". */
export function boardStatus(board: TeamBoard): string {
	const total = board.tasks.length;
	const done = board.tasks.filter((task) => task.state === "done").length;
	const failed = board.tasks.filter((task) => task.state === "failed" || task.state === "skipped").length;
	const active = board.tasks.filter((task) => task.state === "running" || task.state === "verifying" || task.state === "retry");
	const counts = `team ${done}/${total}${failed ? ` ✗${failed}` : ""}`;
	if (board.phase !== "tasks" || active.length === 0) return `${counts} · ${PHASE_LABEL[board.phase]}`;
	const first = active[0];
	const attempt = first.attempts > 1 ? ` (${first.attempts}° tentativo)` : "";
	const more = active.length > 1 ? ` +${active.length - 1}` : "";
	return `${counts} · ${first.id} ${first.role}${attempt}${more}`;
}

const ICON: Record<BoardTaskState, string> = { pending: "·", running: "▶", verifying: "⧗", retry: "↻", done: "✓", failed: "✗", skipped: "⤼" };

/** The board as text (tool updates in the terminal, where there is no card). */
export function renderBoard(board: TeamBoard): string {
	const lines = [`Team · ${PHASE_LABEL[board.phase]}${board.fixRounds ? ` · giri correttivi ${board.fixRounds}` : ""}`];
	for (const task of board.tasks) {
		const attempts = task.attempts > 1 ? ` · tentativo ${task.attempts}` : "";
		const error = task.error && task.state !== "done" ? ` — ${task.error}` : "";
		lines.push(`${ICON[task.state]} ${task.id} [${task.role}] ${task.title}${attempts}${error}`);
	}
	for (const check of board.finalChecks) lines.push(`${check.ok ? "✓" : "✗"} \`${check.command}\``);
	if (board.review) lines.push(`revisione: ${board.review}`);
	return lines.join("\n");
}
