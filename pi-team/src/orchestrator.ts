/**
 * Runs an approved team plan: dependency-ordered scheduling, empirical verification after each
 * task with retries, final verification with corrective rounds, reviewer, and a report.
 * All side effects (agents, commands, progress) are injected so the loop is testable.
 */
import type { AgentFeed } from "./feed.ts";
import type { TeamPlan, TeamTask } from "./plan.ts";
import type { Role } from "./roles.ts";
import type { AgentRun, RunAgent } from "./runner.ts";
import { createBoard, shortError, type TeamBoard } from "./board.ts";
import { notesInstructions, type TeamNotes } from "./notes.ts";
import { changedPaths, filesOverlap, inScope } from "./scope.ts";
import type { VerifyResult } from "./verify.ts";

export interface OrchestratorDependencies {
	roles: Map<string, Role>;
	runAgent: RunAgent;
	runVerify: (commands: string[], cwd: string, signal?: AbortSignal) => Promise<VerifyResult[]>;
	cwd: string;
	/**
	 * Maximum agents at the same time, or a function read at every scheduling step (subscription usage changes
	 * during a run). Writers run together only when their declared files are disjoint.
	 */
	concurrency: number | (() => number);
	/** Hashes of changed files in the working tree (see scope.ts); undefined or missing = writers one at a time. */
	snapshotFiles?: (cwd: string) => Promise<Map<string, string> | undefined>;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
	/** Structured snapshot at every transition (pi-desk's team card, the footer status). */
	onBoard?: (board: TeamBoard) => void;
	/** Shared notes of the run: finished tasks' results are written there and agents are told where it is. */
	notes?: TeamNotes;
	/** Lessons from earlier runs in this project, already formatted (see lessons.ts). */
	lessons?: string;
	maxTaskAttempts?: number;
	maxFixRounds?: number;
	/**
	 * The `parallel` tool's run: no baseline of the checks, final checks only when the plan lists them,
	 * 2 attempts per task and no corrective rounds unless set.
	 */
	light?: boolean;
	/** Live activity of every agent (the `/agents` view). */
	feed?: AgentFeed;
}

export type TaskStatus = "done" | "failed" | "skipped";

export interface TaskOutcome {
	id: string;
	role: string;
	title: string;
	status: TaskStatus;
	attempts: number;
	summary: string;
	lastVerify: VerifyResult[];
	runs: AgentRun[];
	/** One short line per failed attempt (failed check or agent error), in order. */
	failures: string[];
	reason?: string;
}

export type ReviewVerdict = "approved" | "changes" | "skipped" | "error";

export interface TeamReport {
	goal: string;
	tasks: TaskOutcome[];
	finalVerify: VerifyResult[];
	finalOk: boolean;
	review: { verdict: ReviewVerdict; notes: string };
	fixRounds: number;
	/** Final checks that were already failing before the team started. */
	preexistingFailures: string[];
	/** Files changed while writers ran in parallel, outside every file the writer tasks declared. */
	scopeWarnings: string[];
	/**
	 * Tests decide: verified only if the final checks pass. When a final check was already failing
	 * before the team started and every task's own checks passed, the outcome says so explicitly
	 * instead of claiming a regression.
	 */
	outcome: "verified" | "verified_with_review_notes" | "verified_with_preexisting_failures" | "failed";
	totals: { agentRuns: number; inputTokens: number; outputTokens: number; seconds: number };
	board: TeamBoard;
}

const SUMMARY_CHARS = 2500;

/** The "## Risultati" section an agent ends with, or the tail of its answer. */
export function extractSummary(text: string): string {
	const index = text.lastIndexOf("## Risultati");
	const summary = index >= 0 ? text.slice(index + "## Risultati".length) : text;
	return summary.trim().slice(-SUMMARY_CHARS);
}

export function parseReviewVerdict(text: string): { verdict: "approved" | "changes"; notes: string } | undefined {
	const match = /VERDETTO:\s*(APPROVATO|MODIFICHE)([\s\S]*)$/i.exec(text);
	if (!match) return undefined;
	return { verdict: match[1].toUpperCase() === "APPROVATO" ? "approved" : "changes", notes: match[2].replace(/^\s*[—–-]\s*/, "").trim() };
}

function formatVerifyFailure(results: VerifyResult[]): string {
	const failed = results.find((result) => !result.ok);
	if (!failed) return "";
	return `Il comando di verifica \`${failed.command}\` è fallito (codice ${failed.exitCode}). Output:\n\`\`\`\n${failed.outputTail}\n\`\`\``;
}

export async function runTeamPlan(plan: TeamPlan, dependencies: OrchestratorDependencies): Promise<TeamReport> {
	const { roles, cwd, signal } = dependencies;
	const light = dependencies.light === true;
	const maxTaskAttempts = dependencies.maxTaskAttempts ?? (light ? 2 : 3);
	const maxFixRounds = dependencies.maxFixRounds ?? (light ? 0 : 2);
	const progress = (line: string) => dependencies.onProgress?.(line);
	const allRuns: AgentRun[] = [];
	const outcomes = new Map<string, TaskOutcome>();
	const board = createBoard(plan, roles);
	const emit = () => dependencies.onBoard?.(structuredClone(board));
	const boardTask = (id: string) => board.tasks.find((task) => task.id === id)!;
	const skipOutcome = (task: TeamTask, reason: string): TaskOutcome => {
		Object.assign(boardTask(task.id), { state: "skipped", error: reason });
		return { id: task.id, role: task.role, title: task.title, status: "skipped", attempts: 0, summary: "", lastVerify: [], runs: [], failures: [], reason };
	};
	emit();

	let runCount = 0;
	const run = async (role: Role, prompt: string, label: { id: string; title: string; attempt?: number }): Promise<AgentRun> => {
		const key = `${label.id}#${++runCount}`;
		const feed = dependencies.feed;
		feed?.begin({ key, id: label.id, title: label.title, role: role.name, model: role.model, attempt: label.attempt ?? 1 });
		const agentRun = await dependencies.runAgent({ role, prompt, cwd, signal, onEvent: feed ? (event) => feed.event(key, event) : undefined });
		feed?.end(key, agentRun);
		allRuns.push(agentRun);
		return agentRun;
	};

	const dependencyContext = (task: TeamTask) =>
		(task.dependsOn ?? [])
			.map((id) => outcomes.get(id))
			.filter((outcome): outcome is TaskOutcome => Boolean(outcome))
			.map((outcome) => `### ${outcome.id} (${outcome.role}): ${outcome.title}\n${outcome.summary}`)
			.join("\n\n");

	interface TaskState {
		task: TeamTask;
		role: Role;
		outcome: TaskOutcome;
		feedback: string;
		context: string;
	}

	const newState = (task: TeamTask): TaskState => ({
		task,
		role: roles.get(task.role)!,
		outcome: { id: task.id, role: task.role, title: task.title, status: "failed", attempts: 0, summary: "", lastVerify: [], runs: [], failures: [] },
		feedback: "",
		context: dependencyContext(task),
	});

	/** One agent run for the task; false when the agent did not complete (the feedback says why). */
	const attemptAgent = async (state: TaskState, parallel: boolean): Promise<boolean> => {
		const { task, role, outcome, context, feedback } = state;
		outcome.attempts++;
		const entry = boardTask(task.id);
		Object.assign(entry, { state: "running", attempts: outcome.attempts, parallel });
		emit();
		progress(`▶ ${task.id} ${task.role} (${role.model}) · tentativo ${outcome.attempts}${parallel ? " · in parallelo" : ""}: ${task.title}`);
		const prompt = [
			`Obiettivo del team: ${plan.goal}`,
			plan.contracts?.trim() ? `Interfacce concordate tra i compiti (rispettale esattamente, anche se il file di un altro compito non esiste ancora):\n${plan.contracts.trim()}` : "",
			`Il tuo compito (${task.id}): ${task.title}\n\n${task.instructions}`,
			mayShareTree(task) ? `Altri agenti possono lavorare in parallelo nella stessa cartella: modifica SOLO questi file: ${task.files!.map((file) => `\`${file}\``).join(", ")}. Se ti servisse cambiarne altri, non farlo: scrivilo nei Risultati.` : "",
			context ? `Risultati dei compiti da cui dipendi:\n\n${context}` : "",
			dependencies.notes ? notesInstructions(dependencies.notes.path) : "",
			"Nella stessa risposta chiedi insieme le chiamate indipendenti (più file da leggere, più ricerche): Pi le esegue in contemporanea.",
			dependencies.lessons ?? "",
			task.verify?.length ? `Al termine verranno eseguiti questi controlli, che devono passare:\n${task.verify.map((command) => `- \`${command}\``).join("\n")}` : "",
			feedback ? `ATTENZIONE, tentativo precedente non riuscito:\n${feedback}\nCorreggi e completa il compito.` : "",
		].filter(Boolean).join("\n\n");
		const agentRun = await run(role, prompt, { id: task.id, title: task.title, attempt: outcome.attempts });
		outcome.runs.push(agentRun);
		entry.tokens += agentRun.inputTokens + agentRun.outputTokens;
		entry.seconds += agentRun.seconds;
		if (!agentRun.ok) {
			const error = agentRun.error ?? "nessuna risposta";
			state.feedback = `L'agente non ha completato il lavoro: ${error}`;
			outcome.failures.push(`agente: ${shortError(error)}`);
			Object.assign(entry, { state: "retry", error: shortError(error) });
			emit();
			progress(`✗ ${task.id} errore agente: ${error}`);
			return false;
		}
		outcome.summary = extractSummary(agentRun.text);
		return true;
	};

	/** Runs the task's checks after its agent completed; marks it done when they pass. */
	const markDone = async (state: TaskState) => {
		const { task, outcome } = state;
		outcome.status = "done";
		Object.assign(boardTask(task.id), { state: "done", error: undefined, summary: outcome.summary.slice(0, 600) });
		emit();
		await dependencies.notes?.append(`## ${task.id} (${task.role}) ${task.title}\n${outcome.summary}`).catch(() => {});
	};

	const checkTask = async (state: TaskState): Promise<boolean> => {
		const { task, outcome } = state;
		if (!task.verify?.length) {
			await markDone(state);
			return true;
		}
		boardTask(task.id).state = "verifying";
		emit();
		outcome.lastVerify = await verifyQuietly(task);
		if (outcome.lastVerify.every((result) => result.ok)) {
			await markDone(state);
			progress(`✓ ${task.id} verificato`);
			return true;
		}
		state.feedback = formatVerifyFailure(outcome.lastVerify);
		const failed = outcome.lastVerify.find((result) => !result.ok);
		const failedCommand = failed?.command;
		const failure = `\`${failedCommand}\`: ${shortError(failed?.outputTail ?? "")}`;
		outcome.failures.push(failure);
		Object.assign(boardTask(task.id), { state: "retry", error: failure });
		emit();
		if (failedCommand && baseline.get(failedCommand) === false) {
			state.feedback += `\nNota: questo controllo falliva già prima dell'inizio del lavoro del team; se il fallimento non riguarda il tuo compito, dillo esplicitamente nei risultati invece di modificare cose fuori perimetro.`;
		}
		progress(`✗ ${task.id} verifica fallita: ${failedCommand}`);
		return false;
	};

	const finish = (state: TaskState): TaskOutcome => {
		if (state.outcome.status !== "done" && !state.outcome.reason) {
			state.outcome.reason = signal?.aborted ? "interrotto" : `non completato dopo ${state.outcome.attempts} tentativi`;
		}
		if (state.outcome.status !== "done") {
			boardTask(state.task.id).state = "failed";
			emit();
		}
		return state.outcome;
	};

	const scopeWarnings = new Set<string>();
	/**
	 * Writer tasks run as soon as their dependencies are done and their declared files are free: no waves.
	 * A task holds its files for its whole life (agent, checks, retries), so no two running writers share a file.
	 * Checks run right away; a check that fails while other writers are editing runs again once they stop,
	 * and only that result counts (another agent's half-done edit is not this task's failure).
	 */
	const lockedFiles = new Map<string, string[] | undefined>();
	let editing = 0;
	let editEpoch = 0;
	let quietWaiters = 0;
	let wake: () => void = () => {};
	let wakeUp = new Promise<void>((resolve) => (wake = resolve));
	const pulse = () => {
		wake();
		wakeUp = new Promise<void>((resolve) => (wake = resolve));
	};
	const until = async (condition: () => boolean) => {
		while (!condition() && !signal?.aborted) await wakeUp;
	};
	let concurrentWriters = false;
	/** Another writer may edit the tree while this task runs: it must stay inside its declared files. */
	function mayShareTree(task: TeamTask): boolean {
		return canParallelize && Boolean(task.files?.length) && plan.tasks.filter((other) => other.id !== task.id && (roles.get(other.role)?.writes ?? true)).length > 0;
	}

	async function verifyQuietly(task: TeamTask): Promise<VerifyResult[]> {
		const epoch = editEpoch;
		const busy = editing > 0;
		const results = await dependencies.runVerify(task.verify!, cwd, signal);
		if (results.every((result) => result.ok) || (!busy && editing === 0 && epoch === editEpoch)) return results;
		progress(`⏸ ${task.id} controllo fallito mentre altri agenti modificavano file: lo ripeto quando finiscono`);
		quietWaiters++;
		try {
			await until(() => editing === 0);
			return await dependencies.runVerify(task.verify!, cwd, signal);
		} finally {
			quietWaiters--;
			pulse();
		}
	}

	const executeWriter = async (task: TeamTask): Promise<TaskOutcome> => {
		const state = newState(task);
		while (state.outcome.attempts < maxTaskAttempts && !signal?.aborted) {
			// A check waiting for a quiet tree goes first: no new edits start until it ran.
			await until(() => quietWaiters === 0);
			editing++;
			if (editing > 1) concurrentWriters = true;
			const completed = await attemptAgent(state, lockedFiles.size > 1).finally(() => {
				editing--;
				editEpoch++;
				pulse();
			});
			if (completed && (await checkTask(state))) break;
		}
		return finish(state);
	};

	const executeReader = async (task: TeamTask): Promise<TaskOutcome> => {
		const state = newState(task);
		while (state.outcome.attempts < maxTaskAttempts && !signal?.aborted) {
			if ((await attemptAgent(state, false)) && (await checkTask(state))) break;
		}
		return finish(state);
	};

	// --- Baseline: which final checks already fail before any change (known broken tests).
	const baselineCommands = light ? [] : plan.finalVerify?.length ? plan.finalVerify : [...new Set(plan.tasks.flatMap((task) => task.verify ?? []))];
	const baseline = new Map<string, boolean>();
	for (const command of baselineCommands) {
		const [result] = await dependencies.runVerify([command], cwd, signal);
		baseline.set(command, result?.ok ?? false);
	}
	const preexistingFailures = [...baseline].filter(([, passed]) => !passed).map(([command]) => command);
	if (preexistingFailures.length) progress(`ℹ controlli già falliti prima del lavoro: ${preexistingFailures.join(", ")}`);
	board.preexisting = preexistingFailures;
	board.phase = "tasks";
	emit();

	// --- Scheduler: dependency order, a concurrency limit read at every step (the subscription usage moves).
	const startSnapshot = await dependencies.snapshotFiles?.(cwd);
	const canParallelize = startSnapshot !== undefined;
	const limit = () => Math.max(1, typeof dependencies.concurrency === "function" ? dependencies.concurrency() : dependencies.concurrency);
	const pending = new Map(plan.tasks.map((task) => [task.id, task]));
	const running = new Map<string, Promise<void>>();
	const start = (task: TeamTask, execute: (task: TeamTask) => Promise<TaskOutcome>, after?: () => void) => {
		pending.delete(task.id);
		running.set(
			task.id,
			execute(task).then((outcome) => {
				outcomes.set(task.id, outcome);
				after?.();
				running.delete(task.id);
			}),
		);
	};
	while (pending.size > 0 || running.size > 0) {
		for (const [id, task] of pending) {
			const dependencyOutcomes = (task.dependsOn ?? []).map((dependency) => outcomes.get(dependency));
			if (dependencyOutcomes.some((outcome) => outcome && outcome.status !== "done")) {
				pending.delete(id);
				outcomes.set(id, skipOutcome(task, "una dipendenza non è stata completata"));
				emit();
				progress(`⤼ ${id} saltato: dipendenza non completata`);
			}
		}
		const ready = [...pending.values()].filter((task) => (task.dependsOn ?? []).every((dependency) => outcomes.get(dependency)?.status === "done"));
		for (const task of ready) {
			if (running.size >= limit()) break;
			const writes = roles.get(task.role)?.writes ?? true;
			if (!writes) {
				start(task, executeReader);
				continue;
			}
			if (quietWaiters > 0 || (!canParallelize && lockedFiles.size > 0)) continue;
			if ([...lockedFiles.values()].some((files) => filesOverlap(files, task.files))) continue;
			lockedFiles.set(task.id, task.files);
			start(task, executeWriter, () => lockedFiles.delete(task.id));
		}
		if (running.size === 0) {
			// Nothing can start (should not happen with a validated plan): skip what is left.
			for (const [id, task] of pending) outcomes.set(id, skipOutcome(task, "non avviabile"));
			pending.clear();
			emit();
			break;
		}
		// A finished task frees files and slots; a quiet tree lets held-back writers start.
		await Promise.race([...running.values(), wakeUp]);
	}
	if (startSnapshot && concurrentWriters) {
		// Git sees which files changed, not which agent changed them: report what no task declared.
		const endSnapshot = await dependencies.snapshotFiles?.(cwd);
		const declared = plan.tasks.filter((task) => roles.get(task.role)?.writes ?? true);
		if (endSnapshot) for (const path of changedPaths(startSnapshot, endSnapshot)) if (!declared.some((task) => inScope(path, task.files))) scopeWarnings.add(path);
	}

	// --- Final verification with corrective rounds.
	const tasks = plan.tasks.map((task) => outcomes.get(task.id)!);
	const finalCommands = plan.finalVerify?.length ? plan.finalVerify : light ? [] : [...new Set(plan.tasks.flatMap((task) => task.verify ?? []))];
	const implementer = roles.get("implementer");
	const allDone = tasks.every((outcome) => outcome.status === "done");
	let fixRounds = 0;
	let finalVerify: VerifyResult[] = [];
	const verifyAll = async () => {
		const results = finalCommands.length ? await dependencies.runVerify(finalCommands, cwd, signal) : [];
		board.finalChecks = results.map((result) => ({ command: result.command, ok: result.ok }));
		emit();
		return results;
	};
	const corrective = async (reason: string) => {
		fixRounds++;
		Object.assign(board, { phase: "fix", fixRounds });
		emit();
		progress(`🔧 giro correttivo ${fixRounds}`);
		const summaries = tasks.map((outcome) => `- ${outcome.id} (${outcome.role}, ${outcome.status}): ${outcome.title}`).join("\n");
		await run(implementer!, `Obiettivo del team: ${plan.goal}\n\nCompiti già svolti:\n${summaries}\n\nServe un intervento correttivo:\n${reason}\n\nCorreggi il codice (non indebolire i test) e chiudi con "## Risultati".`, { id: "correzione", title: "Intervento correttivo" });
	};

	if (allDone) {
		board.phase = "final";
		emit();
		finalVerify = await verifyAll();
		while (!finalVerify.every((result) => result.ok) && implementer && fixRounds < maxFixRounds && !signal?.aborted) {
			await corrective(formatVerifyFailure(finalVerify));
			finalVerify = await verifyAll();
		}
	}
	let finalOk = allDone && finalVerify.every((result) => result.ok);
	// Failing final checks that were already failing before the team started are not regressions.
	const onlyPreexistingFailures =
		allDone &&
		!finalOk &&
		finalVerify.filter((result) => !result.ok).every((result) => baseline.get(result.command) === false) &&
		tasks.every((outcome) => outcome.lastVerify.every((result) => result.ok || baseline.get(result.command) === false));

	// --- Review: advisory, the tests decide.
	let review: TeamReport["review"] = { verdict: "skipped", notes: "" };
	const reviewer = roles.get("reviewer");
	if (finalOk && plan.review !== false && reviewer && !signal?.aborted) {
		board.phase = "review";
		emit();
		progress("🔍 revisione");
		const reviewPrompt = `Obiettivo del team: ${plan.goal}\n\nCompiti svolti:\n${tasks.map((outcome) => `### ${outcome.id} (${outcome.role}): ${outcome.title}\n${outcome.summary}`).join("\n\n")}\n\nRivedi le modifiche (usa git diff) rispetto all'obiettivo. I controlli ${finalCommands.map((command) => `\`${command}\``).join(", ") || "(nessuno)"} passano.${
			preexistingFailures.length
				? `\n\nQuesti controlli fallivano già prima del lavoro del team: ${preexistingFailures.map((command) => `\`${command}\``).join(", ")}. I problemi che li facevano fallire sono fuori perimetro: non chiederne la correzione, salvo che l'obiettivo la chieda esplicitamente.`
				: ""
		}`;
		const reviewRun = await run(reviewer, reviewPrompt, { id: "revisione", title: "Revisione finale" });
		const parsed = reviewRun.ok ? parseReviewVerdict(reviewRun.text) : undefined;
		review = parsed ?? { verdict: "error", notes: reviewRun.error ?? "verdetto non trovato nella risposta del revisore" };
		board.review = ({ approved: "approvato", changes: "modifiche richieste", error: "non riuscita", skipped: "saltata" } as const)[review.verdict];
		emit();
		if (review.verdict === "changes" && implementer && fixRounds < maxFixRounds + 1) {
			await corrective(`Il revisore chiede queste modifiche:\n${review.notes}`);
			const afterFix = await verifyAll();
			if (afterFix.every((result) => result.ok)) {
				finalVerify = afterFix;
				review.notes = `(applicate dopo la revisione) ${review.notes}`;
			} else {
				// The fix broke the checks: report the regression instead of hiding it.
				finalVerify = afterFix;
				finalOk = false;
			}
		}
	}

	const outcome: TeamReport["outcome"] = finalOk
		? review.verdict === "approved" || review.verdict === "skipped" ? "verified" : "verified_with_review_notes"
		: onlyPreexistingFailures ? "verified_with_preexisting_failures" : "failed";
	Object.assign(board, { phase: "done", outcome, endedAt: Date.now() });
	emit();
	return {
		goal: plan.goal,
		tasks,
		finalVerify,
		finalOk,
		review,
		fixRounds,
		preexistingFailures,
		scopeWarnings: [...scopeWarnings].sort(),
		outcome,
		board: structuredClone(board),
		totals: {
			agentRuns: allRuns.length,
			inputTokens: allRuns.reduce((sum, agentRun) => sum + agentRun.inputTokens, 0),
			outputTokens: allRuns.reduce((sum, agentRun) => sum + agentRun.outputTokens, 0),
			seconds: allRuns.reduce((sum, agentRun) => sum + agentRun.seconds, 0),
		},
	};
}

export function renderReport(report: TeamReport): string {
	const outcomeLabel = {
		verified: "✅ VERIFICATO",
		verified_with_review_notes: "✅ VERIFICATO (note del revisore aperte)",
		verified_with_preexisting_failures: "⚠️ VERIFICATO, MA CON FALLIMENTI PREESISTENTI (non causati dal team)",
		failed: "❌ NON VERIFICATO",
	}[report.outcome];
	const lines = [`# Report del team — ${outcomeLabel}`, `Obiettivo: ${report.goal}`, "", "## Compiti"];
	for (const task of report.tasks) {
		lines.push(`- ${task.status === "done" ? "✓" : task.status === "skipped" ? "⤼" : "✗"} ${task.id} [${task.role}] ${task.title} — ${task.status}, tentativi ${task.attempts}${task.reason ? ` (${task.reason})` : ""}`);
		if (task.summary) lines.push(`  ${task.summary.replace(/\n/g, "\n  ").slice(0, 800)}`);
	}
	lines.push("", "## Verifica finale");
	// Checks that failed in the baseline: the ones passing now were fixed by the team (often the point of the job).
	const passingNow = new Set(report.finalVerify.filter((result) => result.ok).map((result) => result.command));
	const quote = (commands: string[]) => commands.map((command) => `\`${command}\``).join(", ");
	const fixed = report.preexistingFailures.filter((command) => passingNow.has(command));
	const stillFailing = report.preexistingFailures.filter((command) => !passingNow.has(command));
	if (fixed.length) lines.push(`Fallivano prima del team, ora passano: ${quote(fixed)}`);
	if (stillFailing.length) lines.push(`Già falliti prima del lavoro del team: ${quote(stillFailing)}`);
	if (report.finalVerify.length === 0) lines.push(report.finalOk ? "(nessun comando)" : "non eseguita: compiti non completati");
	for (const result of report.finalVerify) lines.push(`- ${result.ok ? "✓" : "✗"} \`${result.command}\`${result.ok ? "" : `\n\`\`\`\n${result.outputTail.slice(-1500)}\n\`\`\``}`);
	if (report.scopeWarnings.length) lines.push("", `⚠️ File cambiati in parallelo fuori dai file dichiarati: ${quote(report.scopeWarnings)}`);
	lines.push("", `## Revisione: ${report.review.verdict}${report.review.notes ? `\n${report.review.notes}` : ""}`);
	lines.push("", `Giri correttivi: ${report.fixRounds} · agenti eseguiti: ${report.totals.agentRuns} · token input ${report.totals.inputTokens}, output ${report.totals.outputTokens} · tempo agenti ${Math.round(report.totals.seconds)}s`);
	return lines.join("\n");
}
