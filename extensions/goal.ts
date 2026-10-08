/**
 * Goal (/goal)
 *
 * Keeps Pi working on a goal across turns until it is done: when the model is about to stop without
 * calling `goal_done`, a reminder is appended and Pi continues. Checks decide success, not claims:
 * with check commands (--check, or the intent's Verifica block) `goal_done` passes only when they pass.
 *
 * Zero fixed cost: nothing at startup, no prompt text; the `goal_done` tool is registered on the first
 * /goal and is active only while a goal runs. Safety: pause after --max continuations (default 20),
 * after two continuations in a row without tool calls, on abort or error, and when the Claude
 * subscription is at ≥ 90% of the 5h window or in extra usage.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activeIntent, INTENTS_DIR, parseIntent, pickIntent, setStatus, slugify, type Intent } from "./intent.ts";

export const DEFAULT_MAX = 20;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL = 4000;
// Written by pi-claude-code after every Claude Code answer (read locally: no import from pi-team, so this
// file also works when loaded through a symlink).
const USAGE_FILE = join(homedir(), ".pi/agent/claude-code-usage.json");

export type GoalArgs =
	| { action: "start"; text: string; checks: string[]; max: number | undefined; intentFile?: string }
	| { action: "status" }
	| { action: "stop" }
	| { action: "resume" }
	| { action: "error"; message: string };

export interface GoalState {
	text: string;
	checks: string[];
	max: number;
	/** Continuations requested so far. */
	continuations: number;
	/** Consecutive continuations that ended without tool calls. */
	idleContinuations: number;
	intentFile?: string;
	paused?: string;
}

export interface TurnInfo {
	outcome: "completed" | "aborted" | "error";
	toolCalls: number;
	budgetStop?: string;
}

export type SettleDecision = { action: "continue" } | { action: "pause"; reason: string };

const USAGE = 'Uso: /goal [--check "cmd"] [--max N] <obiettivo> · /goal @intents/<file>.md · /goal · /goal stop · /goal resume';

export function parseGoalArgs(args: string): GoalArgs {
	const trimmed = args.trim();
	if (trimmed === "" || trimmed === "stato" || trimmed === "status") return { action: "status" };
	if (trimmed === "stop") return { action: "stop" };
	if (trimmed === "resume" || trimmed === "riprendi") return { action: "resume" };

	const tokens = [...trimmed.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => ({ value: match[1] ?? match[2] ?? match[3], quoted: match[3] === undefined }));
	const checks: string[] = [];
	const words: string[] = [];
	let max: number | undefined;
	let intentFile: string | undefined;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token.quoted && (token.value === "--check" || token.value === "--max")) {
			const value = tokens[++index]?.value;
			if (value === undefined || value === "") return { action: "error", message: `${token.value} senza valore. ${USAGE}` };
			if (token.value === "--check") checks.push(value);
			else if (/^[1-9]\d*$/.test(value)) max = Number(value);
			else return { action: "error", message: `--max vuole un intero positivo, non "${value}".` };
		} else if (!token.quoted && token.value.startsWith("@") && token.value.length > 1 && intentFile === undefined) {
			intentFile = token.value.slice(1);
		} else words.push(token.value);
	}
	const text = words.join(" ");
	if (!text && !intentFile) return { action: "error", message: `Manca l'obiettivo. ${USAGE}` };
	return intentFile ? { action: "start", intentFile, text, checks, max } : { action: "start", text, checks, max };
}

const INTENTION = /\b(voglio|vorrei|dovrebbe|bisogna|nuova (funzionalità|feature)|implementa(re)? (una|la|il|un) (funzionalità|feature|gestione|sistema|modulo))(?=[\s.,;:!?]|$)/i; // no trailing \b: it fails after accented letters
const ACTION = /\b(correggi|aggiungi|crea|implementa|rinomina|sposta|scrivi|rimuovi|aggiorna|migra|refactor|genera|prepara|converti|sistema|integra)\w*/i;

/** Large or vague goals get an intent file (persistence across sessions, explicit outcomes); small precise ones do not. */
export function shouldCreateIntent(text: string): boolean {
	if (text.trim().length >= 160) return true;
	if (INTENTION.test(text)) return true;
	const parts = text.split(/,|;|\b(?:e poi|poi|inoltre|infine|dopodiché)\b/i).filter((part) => ACTION.test(part)).length;
	return parts >= 3;
}

export function decideAfterSettle(state: GoalState, turn: TurnInfo): SettleDecision {
	if (turn.outcome === "aborted") return { action: "pause", reason: "interrotto" };
	if (turn.outcome === "error") return { action: "pause", reason: "errore del modello o del provider" };
	if (turn.budgetStop) return { action: "pause", reason: turn.budgetStop };
	if (state.continuations >= state.max) return { action: "pause", reason: `raggiunte ${state.max} continuazioni (--max)` };
	if (turn.toolCalls === 0 && state.idleContinuations >= 1) return { action: "pause", reason: "due giri di fila senza usare tool: sembra bloccato" };
	return { action: "continue" };
}

const bullets = (title: string, items: string[]) => (items.length > 0 ? [`${title}:`, ...items.map((item) => `- ${item}`)] : []);

export function renderReminder(state: GoalState, intent?: Intent): string {
	return [
		`Goal non ancora chiuso (continuazione ${state.continuations + 1}/${state.max}): ${intent?.title || state.text}`,
		...(state.intentFile ? [`Riferimento: ${state.intentFile}`] : []),
		...bullets("Outcome atteso", intent?.outcomes ?? []),
		...bullets("Vincoli", intent?.constraints ?? []),
		"Continua con il prossimo passo concreto. Quando ogni risultato atteso è fatto e provato chiama goal_done con outcomes (n, done, evidence)" +
			(state.checks.length > 0 ? " (eseguirà i controlli)." : ".") +
			" Se non puoi procedere senza l'utente, chiama goal_done con blocked: true e spiega cosa ti serve.",
	].join("\n");
}

export function renderStartMessage(state: GoalState, options: { intent?: Intent; createIntentAt?: string }): string {
	const { visible, instructions } = startMessages(state, options);
	return `${visible}\n\n${instructions}`;
}

/**
 * The goal as the user sees it in the chat, and the working instructions, which go to the model as a hidden message
 * of the same turn (shown in the chat, they looked like text the user had typed).
 */
export function startMessages(state: GoalState, options: { intent?: Intent; createIntentAt?: string }): { visible: string; instructions: string } {
	const { intent, createIntentAt } = options;
	const visible = [`Goal: ${intent?.title || state.text}`];
	if (state.text && intent) visible.push(`Indicazioni aggiuntive: ${state.text}`);
	const lines: string[] = [];
	if (intent && state.intentFile) {
		lines.push(`È descritto nell'intent ${state.intentFile} (leggilo: è il riferimento del lavoro; non cambiarne lo status, lo gestisce /goal).`);
		lines.push(...bullets("Outcome atteso", intent.outcomes), ...bullets("Vincoli", intent.constraints));
		if (intent.openQuestions.length > 0) {
			lines.push("", ...bullets("Prima di lavorare chiudi con l'utente queste domande aperte e aggiorna l'intent con le risposte", intent.openQuestions));
		}
	}
	if (createIntentAt) {
		if (lines.length) lines.push("");
		lines.push(
			`Prima di iniziare scrivi l'intent ${createIntentAt}, sintetizzato da questo obiettivo senza fare domande:`,
			`frontmatter con status: in-progress, created e source: user; sezioni ## Problema, ## Outcome atteso (punti verificabili),`,
			"## Utenti e sistemi impattati, ## Vincoli, ## Domande aperte, ## Verifica (blocco bash con i comandi che dimostrano il risultato, se esistono).",
			"Gli Outcome atteso devono coprire tutto ciò che l'obiettivo chiede, anche le parti difficili o manuali (per esempio una verifica nel browser): goal_done li controllerà uno per uno e il goal non si chiude finché non sono fatti e provati.",
		);
	}
	if (lines.length) lines.push("");
	lines.push(
		"Lavora in autonomia, un passo dopo l'altro, finché l'obiettivo non è raggiunto per intero.",
		"Chiama goal_done solo quando ogni risultato atteso è fatto e provato: riporta ciascuno in outcomes con la prova (comando e risultato, test, file, cosa hai visto). Test verdi su una parte non bastano per il tutto; una parte non fatta non è un \"limite\" da scrivere nel riepilogo, è lavoro ancora da fare.",
	);
	if (state.checks.length > 0) lines.push(`goal_done esegue questi controlli e passa solo se riescono: ${state.checks.map((check) => `\`${check}\``).join(", ")}.`);
	lines.push("Se ti serve una decisione dell'utente, chiama goal_done con blocked: true.");
	return { visible: visible.join("\n"), instructions: lines.join("\n") };
}

function readBudgetStop(): string | undefined {
	try {
		const usage = JSON.parse(readFileSync(USAGE_FILE, "utf8")) as { fiveHourUtilization?: number; isUsingOverage?: boolean };
		if (usage.isUsingOverage) return "l'abbonamento è in extra usage";
		if (usage.fiveHourUtilization !== undefined && usage.fiveHourUtilization >= 0.9) return `finestra 5h al ${Math.round(usage.fiveHourUtilization * 100)}%`;
	} catch {
		// No usage record yet (or not on claude-code): no budget stop.
	}
	return undefined;
}

export function runCheck(command: string, cwd: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		const child = spawn("bash", ["-c", command], { cwd, signal, timeout: CHECK_TIMEOUT_MS });
		let output = "";
		const collect = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-OUTPUT_TAIL);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
		child.on("close", (code) => resolve({ ok: code === 0, output }));
	});
}

export interface OutcomeReport {
	/** Number of the expected outcome (1-based, as listed in the intent). */
	n: number;
	done: boolean;
	/** What proves it: a command and its result, a test, a file, what was seen in the browser. */
	evidence: string;
}

const MIN_EVIDENCE = 12;

/**
 * Whether goal_done may close the goal. Measured: the model closed a goal with green tests while parts of it (a manual
 * check in Chrome, a real PDF) were not done, listing them as "limits" in its summary. Every expected outcome must be
 * reported done with evidence; without an intent, at least one proven point. Otherwise the reason says what is missing.
 */
export function completionVerdict(outcomes: string[], reported: OutcomeReport[]): { ok: true } | { ok: false; reason: string } {
	const proven = (report: OutcomeReport | undefined) => Boolean(report?.done && (report.evidence ?? "").trim().length >= MIN_EVIDENCE);
	if (outcomes.length === 0) {
		return reported.some(proven) ? { ok: true } : { ok: false, reason: "Elenca in outcomes almeno un punto dell'obiettivo fatto, con la prova (comando e risultato, test, file)." };
	}
	const byNumber = new Map(reported.map((report) => [report.n, report]));
	const notDone = outcomes.map((text, index) => ({ text, n: index + 1, report: byNumber.get(index + 1) })).filter(({ report }) => !report?.done);
	const unproven = outcomes.map((text, index) => ({ text, n: index + 1, report: byNumber.get(index + 1) })).filter(({ report }) => report?.done && !proven(report));
	if (!notDone.length && !unproven.length) return { ok: true };
	const list = (items: { n: number; text: string }[]) => items.map(({ n, text }) => `${n}. ${text}`).join("\n");
	return {
		ok: false,
		reason: [
			...(notDone.length ? [`Non è finito: questi risultati attesi non sono fatti o non li hai riportati:\n${list(notDone)}`] : []),
			...(unproven.length ? [`Manca la prova (comando e risultato, test, file, cosa hai visto) per:\n${list(unproven)}`] : []),
			"Il goal resta aperto: continua a lavorarci. Se non puoi farli senza una decisione o un accesso dell'utente, chiama goal_done con blocked: true e spiega cosa ti serve.",
		].join("\n\n"),
	};
}

function readIntent(cwd: string, file: string | undefined): Intent | undefined {
	if (!file) return undefined;
	const path = join(cwd, file);
	return existsSync(path) ? parseIntent(readFileSync(path, "utf8")) : undefined;
}

function markIntent(cwd: string, file: string | undefined, status: "in-progress" | "done"): void {
	if (!file) return;
	const path = join(cwd, file);
	if (existsSync(path)) writeFileSync(path, setStatus(readFileSync(path, "utf8"), status));
}

export default function (pi: ExtensionAPI) {
	let goal: GoalState | undefined;
	let toolCalls = 0;
	let toolRegistered = false;

	const setTool = (on: boolean) => {
		const others = pi.getActiveTools().filter((name) => name !== "goal_done");
		pi.setActiveTools(on ? [...others, "goal_done"] : others);
	};
	const footer = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("goal", goal ? (goal.paused ? `goal in pausa (${goal.continuations}/${goal.max})` : `goal ${goal.continuations}/${goal.max}`) : undefined);
	};
	const tell = (ctx: ExtensionContext, text: string, level: "info" | "warning" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(text, level);
		else console.error(text);
	};
	const pause = (ctx: ExtensionContext, reason: string) => {
		if (!goal) return;
		goal.paused = reason;
		footer(ctx);
		tell(ctx, `Goal in pausa: ${reason}. /goal resume per riprendere, /goal stop per chiudere.`, "warning");
	};
	const finish = (ctx: ExtensionContext) => {
		goal = undefined;
		setTool(false);
		footer(ctx);
	};

	const registerTool = () => {
		if (toolRegistered) return;
		toolRegistered = true;
		pi.registerTool({
			name: "goal_done",
			label: "Goal done",
			description:
				"Call only when every expected outcome of the goal is done and proven. Report each one in outcomes (n as numbered in the intent, done, evidence: command and result, test, file, what you saw). " +
				"The goal closes only if all are done with evidence and the check commands pass; otherwise it stays open and you keep working. " +
				"Something you cannot do without the user: blocked: true, and explain what you need. Never close with parts left as 'limits'.",
			parameters: {
				type: "object",
				properties: {
					summary: { type: "string" },
					outcomes: {
						type: "array",
						items: { type: "object", properties: { n: { type: "number" }, done: { type: "boolean" }, evidence: { type: "string" } }, required: ["n", "done", "evidence"] },
					},
					blocked: { type: "boolean" },
				},
				required: ["summary"],
			} as never,

			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const { summary, blocked, outcomes: reported = [] } = params as { summary: string; blocked?: boolean; outcomes?: OutcomeReport[] };
				const text = (content: string) => ({ content: [{ type: "text" as const, text: content }], details: undefined });
				if (!goal) return text("Nessun goal attivo.");
				if (blocked) {
					pause(ctx, "il modello chiede una decisione all'utente");
					return text("Goal in pausa. Spiega all'utente cosa ti serve e fermati: riprenderà con /goal resume.");
				}
				// The intent as it is now (the model may have written it at the start): its outcomes and its Verifica commands.
				const intent = readIntent(ctx.cwd, goal.intentFile);
				const verdict = completionVerdict(intent?.outcomes ?? [], Array.isArray(reported) ? reported : []);
				if (!verdict.ok) return text(verdict.reason);
				for (const check of [...new Set([...goal.checks, ...(intent?.checks ?? [])])]) {
					const result = await runCheck(check, ctx.cwd, signal);
					if (!result.ok) return text(`Il controllo \`${check}\` fallisce, il goal resta aperto. Correggi e richiama goal_done.\n\n${result.output.trim()}`);
				}
				markIntent(ctx.cwd, goal.intentFile, "done");
				const closed = goal;
				finish(ctx);
				tell(ctx, `Goal completato (${closed.continuations} continuazioni): ${summary.slice(0, 200)}`);
				return text(`Goal completato${closed.checks.length > 0 ? ": tutti i controlli passano" : ""}. Riassumi all'utente in breve e fermati.`);
			},
		});
	};

	// The goal's working instructions ride along with its first turn, hidden from the chat.
	let pendingInstructions: string | undefined;
	pi.on("before_agent_start", () => {
		if (!pendingInstructions) return undefined;
		const content = pendingInstructions;
		pendingInstructions = undefined;
		return { message: { customType: "goal-instructions", content, display: false } };
	});

	// Without a UI (print/json mode) Pi exits when the command returns: wait for the goal's run to finish.
	const send = async (ctx: ExtensionCommandContext, text: string) => {
		pi.sendUserMessage(text);
		if (ctx.hasUI) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
		await ctx.waitForIdle();
	};

	const start = async (ctx: ExtensionCommandContext, state: GoalState, intent: Intent | undefined, createIntentAt?: string) => {
		registerTool();
		goal = state;
		toolCalls = 0;
		setTool(true);
		markIntent(ctx.cwd, state.intentFile, "in-progress");
		footer(ctx);
		const { visible, instructions } = startMessages(state, { intent, createIntentAt });
		pendingInstructions = instructions;
		await send(ctx, visible);
	};

	pi.on("tool_execution_start", () => {
		if (goal) toolCalls++;
	});

	// event.context.canContinue describes the context before our entries (it ends with the assistant reply, so it is
	// false): the reminder entry is what makes the continuation valid, so it is not a reason to stop.
	pi.on("agent_before_settle", (event, ctx) => {
		if (!goal || goal.paused) return;
		const decision = decideAfterSettle(goal, { outcome: event.outcome, toolCalls, budgetStop: readBudgetStop() });
		const calls = toolCalls;
		toolCalls = 0;
		if (decision.action === "pause") return void pause(ctx, decision.reason);
		goal.idleContinuations = calls === 0 ? goal.idleContinuations + 1 : 0;
		const reminder = renderReminder(goal, readIntent(ctx.cwd, goal.intentFile));
		goal.continuations++;
		footer(ctx);
		return { entries: [{ type: "custom_message", customType: "goal-reminder", content: reminder, display: true }], continue: true };
	});

	pi.registerCommand("goal", {
		description: "Lavora in autonomia fino a un obiettivo: /goal [--check \"cmd\"] [--max N] <obiettivo> · /goal @intents/x.md · stop · resume",
		handler: async (args, ctx) => {
			const parsed = parseGoalArgs(args);
			if (parsed.action === "error") return tell(ctx, parsed.message, "warning");
			if (parsed.action === "status") {
				// No goal: pick an open intent (prefills /goal @intents/...), or explain the usage.
				if (!goal) return ctx.mode === "tui" && (await pickIntent(ctx)) ? undefined : tell(ctx, `Nessun goal attivo. ${USAGE}`);
				return tell(ctx, `Goal: ${goal.text || goal.intentFile} · ${goal.continuations}/${goal.max} continuazioni${goal.paused ? ` · in pausa (${goal.paused})` : ""}${goal.checks.length > 0 ? ` · controlli: ${goal.checks.join(", ")}` : ""}`);
			}
			if (parsed.action === "stop") {
				if (!goal) return tell(ctx, "Nessun goal attivo.");
				finish(ctx);
				return tell(ctx, "Goal chiuso.");
			}
			if (!ctx.isIdle()) return tell(ctx, "Pi è occupato: aspetta la fine del turno.", "warning");
			if (parsed.action === "resume") {
				if (goal) {
					goal.paused = undefined;
					goal.continuations = 0;
					goal.idleContinuations = 0;
					toolCalls = 0;
					footer(ctx);
					return send(ctx, renderReminder(goal, readIntent(ctx.cwd, goal.intentFile)));
				}
				const active = activeIntent(ctx.cwd);
				if (!active) return tell(ctx, "Niente da riprendere: nessun goal in pausa né intent in-progress.", "warning");
				return start(ctx, { text: "", checks: active.intent.checks, max: DEFAULT_MAX, continuations: 0, idleContinuations: 0, intentFile: active.file }, active.intent);
			}

			if (goal && !goal.paused) return tell(ctx, "C'è già un goal attivo: /goal stop per chiuderlo.", "warning");
			const max = parsed.max ?? DEFAULT_MAX;
			if (parsed.intentFile) {
				const intent = readIntent(ctx.cwd, parsed.intentFile);
				if (!intent) return tell(ctx, `Intent non trovato: ${parsed.intentFile}`, "warning");
				const checks = parsed.checks.length > 0 ? parsed.checks : intent.checks;
				return start(ctx, { text: parsed.text, checks, max, continuations: 0, idleContinuations: 0, intentFile: parsed.intentFile }, intent);
			}
			const createIntentAt = shouldCreateIntent(parsed.text) ? `${INTENTS_DIR}/${new Date().toISOString().slice(0, 10)}-${slugify(parsed.text.split(/\s+/).slice(0, 6).join(" "))}.md` : undefined;
			return start(ctx, { text: parsed.text, checks: parsed.checks, max, continuations: 0, idleContinuations: 0, intentFile: createIntentAt }, undefined, createIntentAt);
		},
	});
}
