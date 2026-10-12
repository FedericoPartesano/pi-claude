/**
 * pi-team: a team of specialized sub-agents run by the manager (the main Pi session).
 *
 * The manager model writes a plan and calls the `team` tool. The code then guarantees what a
 * model under pressure would skip: the user approves the plan, every task is checked by real
 * commands (tests decide), failures are retried with the error, a reviewer checks the result,
 * and parallelism follows the Claude subscription usage.
 *
 * Guards on the manager (deterministic, per request):
 * - when the user asked for the team, the manager cannot edit files itself before calling it
 *   (unless the team refused the plan as too small, or could not start);
 * - after a team report, re-running the checks the code already ran is blocked until files change again.
 *
 * `parallel` (same agents, no ceremony): 2+ independent parts of a job handed to agents running at the same
 * time; writers need disjoint files. In pi-full both tools stay off until loaded (extensions/tool-groups.ts):
 * agents cost several times what Pi alone does, they are the exception for large jobs, not the default.
 *
 * Environment:
 *   PI_TEAM_AUTO_APPROVE=1  approve plans without asking (non-interactive runs, evaluation)
 *   PI_PARALLEL_MAX=N       most agents at the same time (default 8, less as the 5h window fills)
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { adviseTeam, formatAdvice } from "./src/advisor.ts";
import { decideBudget, liveConcurrency, readUsage } from "./src/budget.ts";
import { renderParallelReport, toParallelPlan, validateParallel } from "./src/parallel.ts";
import { runTeamPlan, renderReport } from "./src/orchestrator.ts";
import { renderPlan, validatePlan, type TeamPlan } from "./src/plan.ts";
import { saveNewRoles, teamGuidance, uncoveredStacks, withNewRoles } from "./src/recruit.ts";
import { loadRoles, type Role } from "./src/roles.ts";
import { detectDependencies, detectVersions, formatSpecialists, matchSpecialists } from "./src/stack.ts";
import { CHILD_ENVIRONMENT_FLAG, runAgent } from "./src/runner.ts";
import { boardStatus, renderBoard, type TeamBoard } from "./src/board.ts";
import { deriveLessons, formatLessons, loadLessons, saveLessons } from "./src/lessons.ts";
import { createNotes } from "./src/notes.ts";
import { AgentFeed } from "./src/feed.ts";
import { snapshotFiles } from "./src/scope.ts";
import { runVerifyCommands } from "./src/verify.ts";

/** Interfaces fixed in the plan: measured cheaper than agents guessing or waiting for each other's files. */
const CONTRACTS_GUIDANCE =
	"When tasks use each other's code or data (one imports a module another writes, a test calls a function another adds), write `contracts` first: the exact exports, signatures, return shapes and formats each task provides. Every agent gets them, so they agree without asking or waiting for each other's files.";

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
	contracts: Type.Optional(Type.String({ description: "Interfaces shared by the tasks: exact exports, signatures, data formats. Required when a task uses another task's code." })),
	review: Type.Optional(Type.Boolean({ description: "Run the reviewer at the end (default true)" })),
	newRoles: Type.Optional(Type.Array(Type.Object({
		name: Type.String({ description: "kebab-case, e.g. vue-dev" }),
		extends: Type.String({ description: "Existing role it specialises: implementer, tester, reviewer…" }),
		description: Type.String({ description: "One line: what it is expert in" }),
		stack: Type.Optional(Type.Array(Type.String(), { description: "Dependencies that make it relevant (package names, @scope/* allowed)" })),
		instructions: Type.String({ description: "Only the expertise, as a short list: conventions, pitfalls, how to test. The base role's rules are inherited" }),
		model: Type.Optional(Type.String({ description: "haiku | sonnet | opus (default: the base role's)" })),
	}), { description: "Specialists to add to the team when the project uses a stack no member covers; saved for future runs once the plan is approved" })),
});

/** The role list of the tool description: general roles in full, specialists by stack. */
export function describeRoles(roles: Map<string, Role>): string {
	const line = (role: Role) => `- ${role.name} (${role.model}${role.writes ? ", modifica file" : ", sola lettura"}): ${role.description}`;
	const general = [...roles.values()].filter((role) => !role.extends);
	const specialists = [...roles.values()].filter((role) => role.extends);
	return [
		...general.map(line),
		...(specialists.length ? ["Specialists (base role's rules plus the expertise; prefer them over the generic role for work in their stack):", ...specialists.map((role) => `${line(role)} [${role.extends}${role.stack?.length ? `; ${role.stack.join(", ")}` : ""}]`)] : []),
	].join("\n");
}

/** One line of role names for the `parallel` tool: model, read-only or writer, specialists' stack. */
export function compactRoles(roles: Map<string, Role>): string {
	return [...roles.values()].map((role) => `${role.name} (${role.model}, ${role.writes ? "writes" : "read-only"}${role.stack?.length ? `; ${role.stack.slice(0, 2).join(", ")}` : ""})`).join(", ");
}

/** The user (or the work advisor) asked for the team in this request. */
export const TEAM_REQUEST = /\b(usa|usare|utilizza|utilizzare)\s+(il\s+)?(tool\s+)?team\b|\buse\s+(the\s+)?team\b|\bteam\s+tool\b/i;

export default function (pi: ExtensionAPI) {
	// Team agents are Pi processes too: they must never start a team themselves.
	if (process.env[CHILD_ENVIRONMENT_FLAG]) return;

	const roles = loadRoles();
	const roleList = describeRoles(roles);
	/** Members to use and stacks lacking one, for the project in `cwd`. */
	const guidanceFor = (cwd: string) => {
		const dependencies = detectDependencies(cwd);
		return teamGuidance(matchSpecialists(roles, dependencies, detectVersions(cwd)), uncoveredStacks(dependencies, roles), formatSpecialists);
	};

	// Advisor: before a request starts, recommend the team only for clearly large jobs (asks, never forces).
	// When the work advisor of extensions/intent.ts is loaded it decides for both (one dialog per request).
	// Per-request guard state, reset when a request starts.
	let teamRequested = false;
	const verifiedCommands = new Set<string>();

	// Live activity of the agents of the current team/parallel run: the /agents view reads it, the chat does not.
	const feed = new AgentFeed();
	const AGENTS_KEY = "ctrl+alt+a";
	const withViewHint = (status: string) => `${status} · ${AGENTS_KEY} agenti`;
	const openAgents = async (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") {
			const lines = feed.agents.map((agent) => `${agent.state === "running" ? "▶" : agent.state === "done" ? "✓" : "✗"} ${agent.id} ${agent.role} · ${agent.inputTokens + agent.outputTokens} token${agent.currentTool ? ` · ${agent.currentTool}` : ""}`);
			return ctx.ui.notify(lines.length ? lines.join("\n") : "Nessun agente.", "info");
		}
		const { AgentsView } = await import("./src/view/agents-view.ts");
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => new AgentsView(feed, theme, () => done(), () => tui.requestRender(), () => Math.max(16, Math.floor((process.stdout.rows || 30) * 0.94))),
			{ overlay: true, overlayOptions: { anchor: "center", width: "98%", maxHeight: "96%" } },
		);
	};
	pi.registerCommand("agents", {
		description: "Vista dal vivo degli agenti del team o di parallel: colonne con ragionamento, strumenti, token (anche ctrl+alt+a)",
		handler: async (_args, ctx) => openAgents(ctx),
	});
	pi.registerShortcut(Key.ctrlAlt("a"), { description: "Vista degli agenti (/agents)", handler: async (ctx) => openAgents(ctx) });

	pi.on("before_agent_start", async (event, ctx) => {
		teamRequested = TEAM_REQUEST.test(event.prompt ?? "");
		verifiedCommands.clear();
		if (!teamRequested) return;
		// The members that fit this project, and what earlier team runs here went wrong: the manager plans with it.
		const lessons = formatLessons(loadLessons(ctx.cwd));
		const content = [guidanceFor(ctx.cwd), lessons && `${lessons}\nTienine conto nel piano (compiti più piccoli, controlli mirati, file dichiarati).`].filter(Boolean).join("\n\n");
		return { message: content ? { customType: "team-guidance", content, display: false } : undefined };
	});

	pi.on("tool_call", async (event) => {
		if (event.parentToolCallId) return;
		if (event.toolName === "edit" || event.toolName === "write") {
			if (teamRequested) {
				return {
					block: true,
					reason: "L'utente ha chiesto il team: non modificare i file tu, chiama il tool team con un piano (se non è attivo, caricalo con load_tools). Se il lavoro è troppo piccolo per il team, il tool te lo dirà e potrai farlo tu.",
				};
			}
			verifiedCommands.clear();
		}
		if (event.toolName === "bash") {
			const command = String((event.input as { command?: string }).command ?? "").trim();
			if (verifiedCommands.has(command)) {
				return { block: true, reason: `\`${command}\` l'ha già eseguito il team dopo l'ultima modifica: l'esito è nel report. Non rieseguirlo, riassumi all'utente.` };
			}
		}
	});

	pi.on("input", async (event, ctx) => {
		if ((globalThis as Record<symbol, unknown>)[Symbol.for("pi-claude.work-advisor")]) return { action: "continue" };
		if (event.source !== "interactive" || event.streamingBehavior || !ctx.hasUI) return { action: "continue" };
		const text = event.text.trim();
		if (text.startsWith("/") || /\bteam\b/i.test(text)) return { action: "continue" };
		const advice = adviseTeam(text, ctx.getContextUsage()?.percent);
		if (!advice.recommendTeam) return { action: "continue" };
		const useTeam = await ctx.ui.confirm("Usare il team?", `${formatAdvice(advice)}\n\nSì: il manager scompone il lavoro e lo affida al team (costa di più, 1,3–2× sui lavori grandi, ma verifica ogni parte e scrive più test).\nNo: Pi da solo.`);
		return useTeam ? { action: "transform", text: `Usa il tool team per questo lavoro.\n\n${event.text}`, images: event.images } : { action: "continue" };
	});

	pi.registerCommand("advise", {
		description: "Valuta se un lavoro conviene farlo con Pi da solo o con il team (non esegue nulla)",
		handler: async (args, ctx) => {
			if (!args.trim()) return ctx.ui.notify("Uso: /advise <descrizione del lavoro>", "info");
			ctx.ui.notify(formatAdvice(adviseTeam(args, ctx.getContextUsage()?.percent)), "info");
		},
	});

	pi.registerCommand("team-members", {
		description: "Membri del team: ruoli generici, specialisti, quelli adatti al progetto e gli stack scoperti",
		handler: async (_args, ctx) => {
			const dependencies = detectDependencies(ctx.cwd);
			const fit = new Set(matchSpecialists(roles, dependencies).map((match) => match.role.name));
			const rows = [...roles.values()].map((role) => {
				const kind = role.extends ? `specialista (${role.extends})` : "generico";
				const origin = role.origin ? ` · ${role.origin}` : "";
				const checked = role.stack?.length ? (role.verified ? ` · verificato ${role.verified} su ${role.sources?.length ?? 0} fonti ufficiali` : " · non verificato su fonti ufficiali") : "";
				return `${fit.has(role.name) ? "★" : " "} ${role.name} · ${role.model} · ${kind}${origin}${checked}\n    ${role.description}`;
			});
			const gaps = uncoveredStacks(dependencies, roles);
			const footer = [
				fit.size ? "★ = adatto a questo progetto" : "",
				gaps.length ? `Stack del progetto senza specialista: ${gaps.map((gap) => gap.label).join(", ")} (il manager può aggiungerlo nel prossimo piano)` : "",
				"Aggiungi o modifica membri in ~/.pi/agent/team/roles/*.md",
			].filter(Boolean);
			ctx.ui.notify(`${rows.join("\n")}\n\n${footer.join("\n")}`, "info");
		},
	});

	pi.registerTool({
		name: "parallel",
		label: "Parallel",
		description: [
			"Run 2+ independent parts of a job at the same time, each with its own agent (fresh context, same project folder).",
			"Use it when the parts do not depend on each other: e.g. one module each, frontend and backend, code and docs,",
			"or several investigations. Faster than doing them one by one; no plan approval. For jobs whose parts depend on",
			"each other, use `team`. Do small single edits yourself.",
			"Every task that changes files declares `files` (files, or folders ending with /), disjoint from the other writers,",
			"and a `verify` command scoped to it (e.g. `node --test test/cart.test.js`): it runs when the agent finishes, a",
			"failure is retried once with the error. Instructions must be self-contained: the agent sees only them and the goal.",
			"Pick the specialist whose stack matches the files (react-dev, nest-dev…), a read-only role for investigations.",
			`Agents run at once up to the subscription budget (up to 8). Roles: ${compactRoles(roles)}.`,
		].join("\n"),
		parameters: Type.Object({
			goal: Type.String({ description: "The overall job, as the user asked it" }),
			tasks: Type.Array(Type.Object({
				role: Type.String({ description: "Role name (see the list)" }),
				title: Type.String({ description: "One-line title" }),
				instructions: Type.String({ description: "Self-contained: what to do, where, when it is done" }),
				files: Type.Optional(Type.Array(Type.String(), { description: "Files or folders (ending with /) a writer may change; disjoint from the other writers" })),
				verify: Type.Optional(Type.Array(Type.String(), { description: "Commands that must exit 0 after the task" })),
			}), { minItems: 2 }),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const text = (content: string) => ({ content: [{ type: "text" as const, text: content }], details: undefined });
			const plan = toParallelPlan(params as Parameters<typeof toParallelPlan>[0]);
			const problems = validateParallel(plan, roles);
			if (problems.length > 0) return text(`Richiesta non valida, correggila e riprova:\n- ${problems.join("\n- ")}`);
			const budget = decideBudget(readUsage());
			if (budget.concurrency === 0) return text(`Agenti paralleli non avviati: ${budget.reason}. Fai il lavoro tu, nelle stesse risposte più chiamate indipendenti insieme.`);

			const progressLines: string[] = [budget.reason];
			let board: TeamBoard | undefined;
			const publish = () => {
				if (!board) return;
				onUpdate?.({ content: [{ type: "text", text: `${renderBoard(board)}\n\n${progressLines.slice(-4).join("\n")}` }], details: { board } });
				if (ctx.hasUI) ctx.ui.setStatus("team", withViewHint(boardStatus(board)));
			};
			let report: Awaited<ReturnType<typeof runTeamPlan>>;
			if (feed.running === 0) feed.reset();
			try {
				report = await runTeamPlan(plan, {
					roles,
					cwd: ctx.cwd,
					concurrency: liveConcurrency(),
					signal,
					runAgent,
					runVerify: runVerifyCommands,
					snapshotFiles,
					feed,
					light: true,
					onProgress: (line) => {
						progressLines.push(line);
						publish();
					},
					onBoard: (snapshot) => {
						board = snapshot;
						publish();
					},
				});
			} finally {
				if (ctx.hasUI) ctx.ui.setStatus("team", undefined);
			}
			const allDone = report.tasks.every((task) => task.status === "done");
			if (allDone) for (const command of plan.tasks.flatMap((task) => task.verify ?? [])) verifiedCommands.add(command.trim());
			const next = allDone
				? "I controlli dei compiti sono già passati: non rieseguirli. Se le parti vanno integrate, fallo tu; poi riassumi all'utente."
				: "Alcuni compiti non sono riusciti: correggili tu (hai l'errore sopra) o chiedi all'utente.";
			return {
				content: [{ type: "text" as const, text: `${renderParallelReport(report)}\n\n${next}` }],
				details: { board: report.board, totals: report.totals },
			};
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
			"Every task that changes files must declare its `files` (files, or folders ending with /): writers with disjoint files run in parallel.",
			"Instructions must be self-contained: the agent sees only them, the goal and its dependencies' results (they also get the run's shared notes).",
			CONTRACTS_GUIDANCE,
			"Split work by file so tasks do not share files (e.g. one task per module with its own test file).",
			"Plan from the request and at most a quick look (ls, one grep): do not read the code in depth before calling",
			"the team, agents read what they need. Put open questions in a scout task (cheap model) that others depend on.",
			"Prefer task verify commands scoped to the task (e.g. `node --test test/cart.test.js`). Final checks that already",
			"fail before the team starts are detected and reported as pre-existing, not as regressions.",
			"",
			"Use the specialist whose stack matches the files of a task (e.g. react-dev for a React component, nest-dev for a",
			"NestJS module). If the project uses a stack no member covers and the job needs it, add one with `newRoles`: it is",
			"shown in the plan and stays in the team for future jobs. Do not add members for small or one-off needs.",
			"",
			"Roles:",
			roleList,
		].join("\n"),
		parameters: TeamPlanSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const plan = params as TeamPlan;
			const text = (content: string) => ({ content: [{ type: "text" as const, text: content }], details: undefined });

			const problems = validatePlan(plan, roles);
			if (problems.length > 0) {
				// Too small for the team: the manager does it itself, the edit guard must not stop it.
				if (problems.some((problem) => /one task/.test(problem))) teamRequested = false;
				return text(`Piano non valido, correggilo e riprova:\n- ${problems.join("\n- ")}`);
			}

			const budget = decideBudget(readUsage());
			if (budget.concurrency === 0) {
				teamRequested = false;
				return text(`Team non avviato: ${budget.reason}.`);
			}

			const rendered = renderPlan(plan, roles);
			const autoApprove = process.env.PI_TEAM_AUTO_APPROVE === "1";
			if (!autoApprove) {
				if (!ctx.hasUI) return text("Team non avviato: serve l'approvazione dell'utente e non c'è interfaccia (imposta PI_TEAM_AUTO_APPROVE=1 per le esecuzioni automatiche).");
				const approved = await ctx.ui.confirm("Approvi il piano del team?", `${rendered}\n\n${budget.reason}`);
				if (!approved) {
					teamRequested = false;
					return text("L'utente ha rifiutato il piano. Chiedigli cosa cambiare prima di riproporlo.");
				}
			}
			teamRequested = false;
			// Approved: the new members join the team for good (this session and the next ones).
			const planRoles = withNewRoles(roles, plan.newRoles);
			const recruited = (() => {
				try {
					return saveNewRoles(plan.newRoles);
				} catch {
					return [];
				}
			})();
			for (const spec of plan.newRoles ?? []) roles.set(spec.name, planRoles.get(spec.name)!);

			const lessons = loadLessons(ctx.cwd);
			const notes = await createNotes(plan.goal).catch(() => undefined);
			const progressLines: string[] = [`${budget.reason}`];
			let board: TeamBoard | undefined;
			// The board goes out as `details` (pi-desk draws the team card), the text for terminals.
			const publish = () => {
				if (!board) return;
				const recent = progressLines.slice(-4).join("\n");
				onUpdate?.({ content: [{ type: "text", text: `${renderBoard(board)}\n\n${recent}` }], details: { board, notes: notes?.path } });
				if (ctx.hasUI) ctx.ui.setStatus("team", withViewHint(boardStatus(board)));
			};
			let report: Awaited<ReturnType<typeof runTeamPlan>>;
			if (feed.running === 0) feed.reset();
			try {
				report = await runTeamPlan(plan, {
					roles: planRoles,
					cwd: ctx.cwd,
					concurrency: liveConcurrency(),
					signal,
					runAgent,
					runVerify: runVerifyCommands,
					snapshotFiles,
					feed,
					notes,
					lessons: formatLessons(lessons),
					onProgress: (line) => {
						progressLines.push(line);
						publish();
					},
					onBoard: (snapshot) => {
						board = snapshot;
						publish();
					},
				});
			} finally {
				if (ctx.hasUI) ctx.ui.setStatus("team", undefined);
			}
			const learned = deriveLessons(report);
			try {
				saveLessons(ctx.cwd, learned);
			} catch {}
			if (report.outcome !== "failed") {
				for (const command of [...report.finalVerify.map((result) => result.command), ...plan.tasks.flatMap((task) => task.verify ?? [])]) verifiedCommands.add(command.trim());
			}
			// The checks already ran in code: re-running them or re-reading the diff only spends the manager's tokens.
			const next = report.outcome === "failed"
				? "Il team non ha completato il lavoro: decidi se correggere tu le parti mancanti o chiedere all'utente."
				: "Controlli già eseguiti dal codice: non rieseguirli e non rileggere il diff. Riassumi all'utente in breve.";
			const recruitedText = plan.newRoles?.length ? `\n\nNuovi membri nel team: ${plan.newRoles.map((spec) => spec.name).join(", ")}${recruited.length ? ` (salvati in ${recruited.map((file) => file.replace(/^.*\/\.pi\//, "~/.pi/")).join(", ")})` : ""}.` : "";
			const lessonCount = learned.filter((lesson) => lesson.kind !== "fixed").length;
			const learnedText = recruitedText + (lessonCount ? `\n\nLezioni registrate per i prossimi lavori: ${lessonCount}.` : "");
			return {
				content: [{ type: "text" as const, text: `${renderReport(report)}${learnedText}\n\n${next}` }],
				details: { board: report.board, notes: notes?.path, outcome: report.outcome, totals: report.totals },
			};
		},
	});
}
