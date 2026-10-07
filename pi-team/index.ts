/**
 * pi-team: a team of specialized sub-agents run by the manager (the main Pi session).
 *
 * The manager model writes a plan and calls the `team` tool. The code then guarantees what a
 * model under pressure would skip: the user approves the plan, every task is checked by real
 * commands (tests decide), failures are retried with the error, a reviewer checks the result,
 * and parallelism follows the Claude subscription usage.
 *
 * Environment:
 *   PI_TEAM_AUTO_APPROVE=1  approve plans without asking (non-interactive runs, evaluation)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { adviseTeam, formatAdvice } from "./src/advisor.ts";
import { decideBudget, readUsage } from "./src/budget.ts";
import { runTeamPlan, renderReport } from "./src/orchestrator.ts";
import { renderPlan, validatePlan, type TeamPlan } from "./src/plan.ts";
import { loadRoles } from "./src/roles.ts";
import { CHILD_ENVIRONMENT_FLAG, runAgent } from "./src/runner.ts";
import { teamStatus } from "./src/progress.ts";
import { snapshotFiles } from "./src/scope.ts";
import { runVerifyCommands } from "./src/verify.ts";

const TeamTaskSchema = Type.Object({
	id: Type.String({ description: "Short unique id, e.g. t1" }),
	role: Type.String({ description: "Role name (see the list in the tool description)" }),
	title: Type.String({ description: "One-line title" }),
	instructions: Type.String({ description: "Self-contained instructions: the agent sees only these, the goal and its dependencies' results" }),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Ids of tasks that must finish first" })),
	verify: Type.Optional(Type.Array(Type.String(), { description: "Shell commands that must exit 0 after the task (tests, build, a node -e check)" })),
	files: Type.Optional(Type.Array(Type.String(), { description: "Files (or folders ending with /) a writer task may change; writers with disjoint files run in parallel" })),
});

const TeamPlanSchema = Type.Object({
	goal: Type.String({ description: "What the whole team must achieve, as the user asked it" }),
	tasks: Type.Array(TeamTaskSchema),
	finalVerify: Type.Optional(Type.Array(Type.String(), { description: "Shell commands that must pass on the final result, e.g. the full test suite" })),
	review: Type.Optional(Type.Boolean({ description: "Run the reviewer at the end (default true)" })),
});

export default function (pi: ExtensionAPI) {
	// Team agents are Pi processes too: they must never start a team themselves.
	if (process.env[CHILD_ENVIRONMENT_FLAG]) return;

	const roles = loadRoles();
	const roleList = [...roles.values()].map((role) => `- ${role.name} (${role.model}${role.writes ? ", modifica file" : ", sola lettura"}): ${role.description}`).join("\n");

	// Advisor: before a request starts, recommend the team only for clearly large jobs (asks, never forces).
	// When the work advisor of extensions/intent.ts is loaded it decides for both (one dialog per request).
	pi.on("input", async (event, ctx) => {
		if ((globalThis as Record<symbol, unknown>)[Symbol.for("pi-claude.work-advisor")]) return { action: "continue" };
		if (event.source !== "interactive" || event.streamingBehavior || !ctx.hasUI) return { action: "continue" };
		const text = event.text.trim();
		if (text.startsWith("/") || /\bteam\b/i.test(text)) return { action: "continue" };
		const advice = adviseTeam(text, ctx.getContextUsage()?.percent);
		if (!advice.recommendTeam) return { action: "continue" };
		const useTeam = await ctx.ui.confirm("Usare il team?", `${formatAdvice(advice)}\n\nSì: il manager scompone il lavoro e lo affida al team (costa ~3× ma verifica ogni parte).\nNo: Pi da solo.`);
		return useTeam ? { action: "transform", text: `Usa il tool team per questo lavoro.\n\n${event.text}`, images: event.images } : { action: "continue" };
	});

	pi.registerCommand("consiglia", {
		description: "Valuta se un lavoro conviene farlo con Pi da solo o con il team (non esegue nulla)",
		handler: async (args, ctx) => {
			if (!args.trim()) return ctx.ui.notify("Uso: /consiglia <descrizione del lavoro>", "info");
			ctx.ui.notify(formatAdvice(adviseTeam(args, ctx.getContextUsage()?.percent)), "info");
		},
	});

	pi.registerTool({
		name: "team",
		label: "Team",
		description: [
			"Delegate a multi-step job to a team of specialized sub-agents. You are the manager: split the job into small,",
			"self-contained tasks, pick a role for each, order them with dependsOn, and give every task that changes files",
			"a verify command (tests, build, a `node -e` assertion). The code runs the plan: it asks the user to approve it,",
			"runs tasks (read-only roles in parallel, writers in parallel only on disjoint files), re-runs failed checks with the error up to 3",
			"times, runs finalVerify with corrective rounds, asks the reviewer, and returns a report. Checks decide success,",
			"not the agents' claims. Use it for jobs with several distinct parts; do small edits yourself.",
			"A plan needs 2+ separable tasks: a one-task plan is rejected (do that work yourself).",
			"Give every implementer/tester task its `files`: writers with disjoint files run in parallel, without files one at a time.",
			"Split work by file so tasks do not share files (e.g. one task per module with its own test file).",
			"Plan from the request and at most a quick look (ls, one grep): do not read the code in depth before calling",
			"the team, agents read what they need. Put open questions in a scout task (cheap model) that others depend on.",
			"Prefer task verify commands scoped to the task (e.g. `node --test test/cart.test.js`). Final checks that already",
			"fail before the team starts are detected and reported as pre-existing, not as regressions.",
			"",
			"Roles:",
			roleList,
		].join("\n"),
		parameters: TeamPlanSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const plan = params as TeamPlan;
			const text = (content: string) => ({ content: [{ type: "text" as const, text: content }], details: undefined });

			const problems = validatePlan(plan, roles);
			if (problems.length > 0) return text(`Piano non valido, correggilo e riprova:\n- ${problems.join("\n- ")}`);

			const budget = decideBudget(readUsage());
			if (budget.concurrency === 0) return text(`Team non avviato: ${budget.reason}.`);

			const rendered = renderPlan(plan, roles);
			const autoApprove = process.env.PI_TEAM_AUTO_APPROVE === "1";
			if (!autoApprove) {
				if (!ctx.hasUI) return text("Team non avviato: serve l'approvazione dell'utente e non c'è interfaccia (imposta PI_TEAM_AUTO_APPROVE=1 per le esecuzioni automatiche).");
				const approved = await ctx.ui.confirm("Approvi il piano del team?", `${rendered}\n\n${budget.reason}`);
				if (!approved) return text("L'utente ha rifiutato il piano. Chiedigli cosa cambiare prima di riproporlo.");
			}

			const progressLines: string[] = [`${budget.reason}`];
			let report: Awaited<ReturnType<typeof runTeamPlan>>;
			try {
				report = await runTeamPlan(plan, {
					roles,
					cwd: ctx.cwd,
					concurrency: budget.concurrency,
					signal,
					runAgent,
					runVerify: runVerifyCommands,
					snapshotFiles,
					onProgress: (line) => {
						progressLines.push(line);
						onUpdate?.({ content: [{ type: "text", text: progressLines.slice(-12).join("\n") }], details: undefined });
						// Shown in the footer (and in pi-ui's panel) while the team works.
						if (ctx.hasUI) ctx.ui.setStatus("team", teamStatus(progressLines, plan.tasks.length));
					},
				});
			} finally {
				if (ctx.hasUI) ctx.ui.setStatus("team", undefined);
			}
			// The checks already ran in code: re-running them or re-reading the diff only spends the manager's tokens.
			const next = report.outcome === "failed"
				? "Il team non ha completato il lavoro: decidi se correggere tu le parti mancanti o chiedere all'utente."
				: "Controlli già eseguiti dal codice: non rieseguirli e non rileggere il diff. Riassumi all'utente in breve.";
			return text(`${renderReport(report)}\n\n${next}`);
		},
	});
}
