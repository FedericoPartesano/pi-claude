/**
 * Runs an approved team plan: dependency-ordered scheduling, empirical verification after each
 * task with retries, final verification with corrective rounds, reviewer, and a report.
 * All side effects (agents, commands, progress) are injected so the loop is testable.
 */
import type { TeamPlan, TeamTask } from "./plan.ts";
import type { Role } from "./roles.ts";
import type { AgentRun, RunAgent } from "./runner.ts";
import type { VerifyResult } from "./verify.ts";

export interface OrchestratorDependencies {
	roles: Map<string, Role>;
	runAgent: RunAgent;
	runVerify: (commands: string[], cwd: string, signal?: AbortSignal) => Promise<VerifyResult[]>;
	cwd: string;
	/** Maximum agents at the same time (writers are always one at a time). */
	concurrency: number;
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

	const executeTask = async (task: TeamTask): Promise<TaskOutcome> => {
		const role = roles.get(task.role)!;
		const outcome: TaskOutcome = { id: task.id, role: task.role, title: task.title, status: "failed", attempts: 0, summary: "", lastVerify: [], runs: [] };
		let feedback = "";
		const context = dependencyContext(task);
		for (let attempt = 1; attempt <= maxTaskAttempts; attempt++) {
			if (signal?.aborted) {
				outcome.reason = "interrotto";
				break;
			}
			outcome.attempts = attempt;
			progress(`▶ ${task.id} ${task.role} (${role.model}) · tentativo ${attempt}: ${task.title}`);
			const prompt = [
				`Obiettivo del team: ${plan.goal}`,
				`Il tuo compito (${task.id}): ${task.title}\n\n${task.instructions}`,
				context ? `Risultati dei compiti da cui dipendi:\n\n${context}` : "",
				task.verify?.length ? `Al termine verranno eseguiti questi controlli, che devono passare:\n${task.verify.map((command) => `- \`${command}\``).join("\n")}` : "",
				feedback ? `ATTENZIONE, tentativo precedente non riuscito:\n${feedback}\nCorreggi e completa il compito.` : "",
			].filter(Boolean).join("\n\n");
			const agentRun = await run(role, prompt);
			outcome.runs.push(agentRun);
			if (!agentRun.ok) {
				feedback = `L'agente non ha completato il lavoro: ${agentRun.error ?? "nessuna risposta"}`;
				progress(`✗ ${task.id} errore agente: ${agentRun.error ?? "nessuna risposta"}`);
				continue;
			}
			outcome.summary = extractSummary(agentRun.text);
			if (!task.verify?.length) {
				outcome.status = "done";
				break;
			}
			outcome.lastVerify = await dependencies.runVerify(task.verify, cwd, signal);
			if (outcome.lastVerify.every((result) => result.ok)) {
				outcome.status = "done";
				progress(`✓ ${task.id} verificato`);
				break;
			}
			feedback = formatVerifyFailure(outcome.lastVerify);
			const failedCommand = outcome.lastVerify.find((result) => !result.ok)?.command;
			if (failedCommand && baseline.get(failedCommand) === false) {
				feedback += `\nNota: questo controllo falliva già prima dell'inizio del lavoro del team; se il fallimento non riguarda il tuo compito, dillo esplicitamente nei risultati invece di modificare cose fuori perimetro.`;
			}
			progress(`✗ ${task.id} verifica fallita: ${outcome.lastVerify.find((result) => !result.ok)?.command}`);
		}
		if (outcome.status !== "done" && !outcome.reason) outcome.reason = `non completato dopo ${outcome.attempts} tentativi`;
		return outcome;
	};

	// --- Baseline: which final checks already fail before any change (known broken tests).
	const baselineCommands = plan.finalVerify?.length ? plan.finalVerify : [...new Set(plan.tasks.flatMap((task) => task.verify ?? []))];
	const baseline = new Map<string, boolean>();
	for (const command of baselineCommands) {
		const [result] = await dependencies.runVerify([command], cwd, signal);
		baseline.set(command, result?.ok ?? false);
	}
	const preexistingFailures = [...baseline].filter(([, passed]) => !passed).map(([command]) => command);
	if (preexistingFailures.length) progress(`ℹ controlli già falliti prima del lavoro: ${preexistingFailures.join(", ")}`);

	// --- Scheduler: dependency order, bounded concurrency, writers one at a time.
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
		for (const task of ready) {
			if (running.size >= Math.max(1, dependencies.concurrency)) break;
			const writes = roles.get(task.role)?.writes ?? true;
			if (writes && writerRunning) continue;
			pending.delete(task.id);
			if (writes) writerRunning = true;
			running.set(
				task.id,
				executeTask(task).then((outcome) => {
					outcomes.set(task.id, outcome);
					running.delete(task.id);
					if (writes) writerRunning = false;
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
	lines.push("", `## Revisione: ${report.review.verdict}${report.review.notes ? `\n${report.review.notes}` : ""}`);
	lines.push("", `Giri correttivi: ${report.fixRounds} · agenti eseguiti: ${report.totals.agentRuns} · token input ${report.totals.inputTokens}, output ${report.totals.outputTokens} · tempo agenti ${Math.round(report.totals.seconds)}s`);
	return lines.join("\n");
}
