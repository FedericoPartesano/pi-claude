/**
 * Runs an approved team plan: dependency-ordered scheduling, empirical verification after each
 * task with retries, final verification with corrective rounds, reviewer, and a report.
 * All side effects (agents, commands, progress) are injected so the loop is testable.
 */
import type { TeamPlan, TeamTask } from "./plan.ts";
import type { Role } from "./roles.ts";
import type { AgentRun, RunAgent } from "./runner.ts";
import { changedPaths, filesOverlap, inScope } from "./scope.ts";
import type { VerifyResult } from "./verify.ts";

export interface OrchestratorDependencies {
	roles: Map<string, Role>;
	runAgent: RunAgent;
	runVerify: (commands: string[], cwd: string, signal?: AbortSignal) => Promise<VerifyResult[]>;
	cwd: string;
	/** Maximum agents at the same time. Writers run together only when their declared files are disjoint. */
	concurrency: number;
	/** Hashes of changed files in the working tree (see scope.ts); undefined or missing = writers one at a time. */
	snapshotFiles?: (cwd: string) => Promise<Map<string, string> | undefined>;
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
	maxTaskAttempts?: number;
	maxFixRounds?: number;
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
	/** Files changed by a parallel wave outside every file its tasks declared. */
	scopeWarnings: string[];
	/**
	 * Tests decide: verified only if the final checks pass. When a final check was already failing
	 * before the team started and every task's own checks passed, the outcome says so explicitly
	 * instead of claiming a regression.
	 */
	outcome: "verified" | "verified_with_review_notes" | "verified_with_preexisting_failures" | "failed";
	totals: { agentRuns: number; inputTokens: number; outputTokens: number; seconds: number };
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
	const maxTaskAttempts = dependencies.maxTaskAttempts ?? 3;
	const maxFixRounds = dependencies.maxFixRounds ?? 2;
	const progress = (line: string) => dependencies.onProgress?.(line);
	const allRuns: AgentRun[] = [];
	const outcomes = new Map<string, TaskOutcome>();

	const run = async (role: Role, prompt: string): Promise<AgentRun> => {
		const agentRun = await dependencies.runAgent({ role, prompt, cwd, signal });
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
		outcome: { id: task.id, role: task.role, title: task.title, status: "failed", attempts: 0, summary: "", lastVerify: [], runs: [] },
		feedback: "",
		context: dependencyContext(task),
	});

	/** One agent run for the task; false when the agent did not complete (the feedback says why). */
	const attemptAgent = async (state: TaskState, parallel: boolean): Promise<boolean> => {
		const { task, role, outcome, context, feedback } = state;
		outcome.attempts++;
		progress(`▶ ${task.id} ${task.role} (${role.model}) · tentativo ${outcome.attempts}${parallel ? " · in parallelo" : ""}: ${task.title}`);
		const prompt = [
			`Obiettivo del team: ${plan.goal}`,
			`Il tuo compito (${task.id}): ${task.title}\n\n${task.instructions}`,
			parallel ? `Altri agenti lavorano in parallelo nella stessa cartella: modifica SOLO questi file: ${task.files!.map((file) => `\`${file}\``).join(", ")}. Se ti servisse cambiarne altri, non farlo: scrivilo nei Risultati.` : "",
			context ? `Risultati dei compiti da cui dipendi:\n\n${context}` : "",
			task.verify?.length ? `Al termine verranno eseguiti questi controlli, che devono passare:\n${task.verify.map((command) => `- \`${command}\``).join("\n")}` : "",
			feedback ? `ATTENZIONE, tentativo precedente non riuscito:\n${feedback}\nCorreggi e completa il compito.` : "",
		].filter(Boolean).join("\n\n");
		const agentRun = await run(role, prompt);
		outcome.runs.push(agentRun);
		if (!agentRun.ok) {
			state.feedback = `L'agente non ha completato il lavoro: ${agentRun.error ?? "nessuna risposta"}`;
			progress(`✗ ${task.id} errore agente: ${agentRun.error ?? "nessuna risposta"}`);
			return false;
		}
		outcome.summary = extractSummary(agentRun.text);
		return true;
	};

	/** Runs the task's checks after its agent completed; marks it done when they pass. */
	const checkTask = async (state: TaskState): Promise<boolean> => {
		const { task, outcome } = state;
		if (!task.verify?.length) {
			outcome.status = "done";
			return true;
		}
		outcome.lastVerify = await dependencies.runVerify(task.verify, cwd, signal);
		if (outcome.lastVerify.every((result) => result.ok)) {
			outcome.status = "done";
			progress(`✓ ${task.id} verificato`);
			return true;
		}
		state.feedback = formatVerifyFailure(outcome.lastVerify);
		const failedCommand = outcome.lastVerify.find((result) => !result.ok)?.command;
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
		return state.outcome;
	};

	/**
	 * Runs writer tasks with disjoint declared files as waves: agents of a wave work at the same time,
	 * then each task's checks run one by one (no check sees another agent's half-done work), and failed
	 * tasks retry together in the next wave. A single task is just a wave of one.
	 */
	const scopeWarnings = new Set<string>();
	const executeWave = async (tasks: TeamTask[]): Promise<TaskOutcome[]> => {
		const states = tasks.map(newState);
		let active = states;
		while (active.length > 0 && !signal?.aborted) {
			const parallel = active.length > 1;
			const before = parallel ? await dependencies.snapshotFiles?.(cwd) : undefined;
			const completed = await Promise.all(active.map((state) => attemptAgent(state, parallel)));
			const after = before ? await dependencies.snapshotFiles?.(cwd) : undefined;
			if (before && after) {
				// Git sees which files changed, not which agent changed them: report what no task declared.
				for (const path of changedPaths(before, after)) if (!active.some((state) => inScope(path, state.task.files))) scopeWarnings.add(path);
			}
			const retry: TaskState[] = [];
			for (const [index, state] of active.entries()) {
				const passed = completed[index] && (await checkTask(state));
				if (!passed && state.outcome.attempts < maxTaskAttempts) retry.push(state);
			}
			active = retry;
		}
		return states.map(finish);
	};

	const executeTask = async (task: TeamTask): Promise<TaskOutcome> => (await executeWave([task]))[0];

	// --- Baseline: which final checks already fail before any change (known broken tests).
	const baselineCommands = plan.finalVerify?.length ? plan.finalVerify : [...new Set(plan.tasks.flatMap((task) => task.verify ?? []))];
	const baseline = new Map<string, boolean>();
	for (const command of baselineCommands) {
		const [result] = await dependencies.runVerify([command], cwd, signal);
		baseline.set(command, result?.ok ?? false);
	}
	const preexistingFailures = [...baseline].filter(([, passed]) => !passed).map(([command]) => command);
	if (preexistingFailures.length) progress(`ℹ controlli già falliti prima del lavoro: ${preexistingFailures.join(", ")}`);

	// --- Scheduler: dependency order, bounded concurrency; writers in waves of disjoint declared files.
	const canParallelize = (await dependencies.snapshotFiles?.(cwd)) !== undefined;
	const pending = new Map(plan.tasks.map((task) => [task.id, task]));
	const running = new Map<string, Promise<void>>();
	let writerRunning = false;
	while (pending.size > 0 || running.size > 0) {
		for (const [id, task] of pending) {
			const dependencyOutcomes = (task.dependsOn ?? []).map((dependency) => outcomes.get(dependency));
			if (dependencyOutcomes.some((outcome) => outcome && outcome.status !== "done")) {
				pending.delete(id);
				outcomes.set(id, { id, role: task.role, title: task.title, status: "skipped", attempts: 0, summary: "", lastVerify: [], runs: [], reason: "una dipendenza non è stata completata" });
				progress(`⤼ ${id} saltato: dipendenza non completata`);
			}
		}
		const ready = [...pending.values()].filter((task) => (task.dependsOn ?? []).every((dependency) => outcomes.get(dependency)?.status === "done"));
		const slots = () => Math.max(1, dependencies.concurrency) - running.size;
		for (const task of ready.filter((candidate) => !(roles.get(candidate.role)?.writes ?? true))) {
			if (slots() <= 0) break;
			pending.delete(task.id);
			running.set(
				task.id,
				executeTask(task).then((outcome) => {
					outcomes.set(task.id, outcome);
					running.delete(task.id);
				}),
			);
		}
		const readyWriters = ready.filter((candidate) => roles.get(candidate.role)?.writes ?? true);
		if (!writerRunning && readyWriters.length > 0 && (slots() > 0 || running.size === 0)) {
			const wave = [readyWriters[0]];
			if (canParallelize) {
				for (const candidate of readyWriters.slice(1)) {
					if (wave.length >= Math.max(1, slots())) break;
					if (wave.every((member) => !filesOverlap(member.files, candidate.files))) wave.push(candidate);
				}
			}
			for (const task of wave) pending.delete(task.id);
			writerRunning = true;
			const key = `wave:${wave.map((task) => task.id).join(",")}`;
			running.set(
				key,
				executeWave(wave).then((waveOutcomes) => {
					for (const outcome of waveOutcomes) outcomes.set(outcome.id, outcome);
					running.delete(key);
					writerRunning = false;
				}),
			);
		}
		if (running.size === 0) {
			// Nothing can start (should not happen with a validated plan): skip what is left.
			for (const [id, task] of pending) outcomes.set(id, { id, role: task.role, title: task.title, status: "skipped", attempts: 0, summary: "", lastVerify: [], runs: [], reason: "non avviabile" });
			pending.clear();
			break;
		}
		await Promise.race(running.values());
	}

	// --- Final verification with corrective rounds.
	const tasks = plan.tasks.map((task) => outcomes.get(task.id)!);
	const finalCommands = plan.finalVerify?.length ? plan.finalVerify : [...new Set(plan.tasks.flatMap((task) => task.verify ?? []))];
	const implementer = roles.get("implementer");
	const allDone = tasks.every((outcome) => outcome.status === "done");
	let fixRounds = 0;
	let finalVerify: VerifyResult[] = [];
	const verifyAll = async () => (finalCommands.length ? dependencies.runVerify(finalCommands, cwd, signal) : []);
	const corrective = async (reason: string) => {
		fixRounds++;
		progress(`🔧 giro correttivo ${fixRounds}`);
		const summaries = tasks.map((outcome) => `- ${outcome.id} (${outcome.role}, ${outcome.status}): ${outcome.title}`).join("\n");
		await run(implementer!, `Obiettivo del team: ${plan.goal}\n\nCompiti già svolti:\n${summaries}\n\nServe un intervento correttivo:\n${reason}\n\nCorreggi il codice (non indebolire i test) e chiudi con "## Risultati".`);
	};

	if (allDone) {
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
		progress("🔍 revisione");
		const reviewPrompt = `Obiettivo del team: ${plan.goal}\n\nCompiti svolti:\n${tasks.map((outcome) => `### ${outcome.id} (${outcome.role}): ${outcome.title}\n${outcome.summary}`).join("\n\n")}\n\nRivedi le modifiche (usa git diff) rispetto all'obiettivo. I controlli ${finalCommands.map((command) => `\`${command}\``).join(", ") || "(nessuno)"} passano.${
			preexistingFailures.length
				? `\n\nQuesti controlli fallivano già prima del lavoro del team: ${preexistingFailures.map((command) => `\`${command}\``).join(", ")}. I problemi che li facevano fallire sono fuori perimetro: non chiederne la correzione, salvo che l'obiettivo la chieda esplicitamente.`
				: ""
		}`;
		const reviewRun = await run(reviewer, reviewPrompt);
		const parsed = reviewRun.ok ? parseReviewVerdict(reviewRun.text) : undefined;
		review = parsed ?? { verdict: "error", notes: reviewRun.error ?? "verdetto non trovato nella risposta del revisore" };
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

	return {
		goal: plan.goal,
		tasks,
		finalVerify,
		finalOk,
		review,
		fixRounds,
		preexistingFailures,
		scopeWarnings: [...scopeWarnings].sort(),
		outcome: finalOk
			? review.verdict === "approved" || review.verdict === "skipped" ? "verified" : "verified_with_review_notes"
			: onlyPreexistingFailures ? "verified_with_preexisting_failures" : "failed",
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
