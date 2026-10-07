/**
 * Intent (intent.md files, AI-native SDLC style)
 *
 * An intent states what is wanted, why, and under which constraints, before any design. Intents live in
 * `intents/<date>-<slug>.md` in the project root and feed /goal, /loop and pi-team.
 *
 * - /intent <idea>  the model interviews the user and writes a draft intent
 * - /intent         lists the project's intents with their status
 * - automatic use: a local advisor proposes an intent for vague feature requests (or the team for large
 *   jobs), the in-progress intent is announced at startup and re-injected after compaction.
 *   PI_INTENT_ADVISOR=off|ask|auto (default ask; auto starts the interview without asking).
 *
 * Zero cost per request: no tools, no system prompt text. Pure helpers are exported for the other extensions.
 * Load it from its real path (settings.json `extensions` or `pi -e`): it imports ./work-advisor.ts, and Pi does
 * not resolve symlinks for relative imports.
 * Format and rationale: docs/research/2026-10-06-intent-md-best-practices.md
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_FIRST_HINT, adviseWork, formatWorkAdvice } from "./work-advisor.ts";

export const INTENTS_DIR = "intents";
export const STATUSES = ["draft", "ready", "in-progress", "done", "rejected"] as const;
export type IntentStatus = (typeof STATUSES)[number];

export interface Intent {
	status: IntentStatus;
	created?: string;
	source: "user" | "loop";
	title: string;
	problem: string;
	outcomes: string[];
	users: string;
	constraints: string[];
	openQuestions: string[];
	/** Commands from the optional verification block, one per line. */
	checks: string[];
	/** Required sections that are missing or empty. */
	missing: string[];
}

// Section headings, Italian and English (lowercase, matched by prefix).
const SECTIONS = {
	problem: ["problema", "problem"],
	outcome: ["outcome", "risultato", "proposed outcome"],
	users: ["utenti", "affected users", "users"],
	constraints: ["vincoli", "constraints"],
	questions: ["domande aperte", "open questions"],
	checks: ["verifica", "verification", "checks"],
} as const;
type SectionKey = keyof typeof SECTIONS;
const REQUIRED: SectionKey[] = ["problem", "outcome", "users", "constraints"];

// Bodies that mean "nothing here" (e.g. no open questions).
const EMPTY_BODY = /^(-\s*)?(nessuna|nessuno|none|n\/a|-)\.?$/i;

function splitFrontmatter(text: string): { fields: Record<string, string>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	if (!match) return { fields: {}, body: text };
	const fields: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const field = /^(\w[\w-]*):\s*(.*?)\s*(#.*)?$/.exec(line);
		if (field) fields[field[1]] = field[2];
	}
	return { fields, body: text.slice(match[0].length) };
}

function sectionKey(heading: string): SectionKey | undefined {
	const normalized = heading.trim().toLowerCase();
	return (Object.keys(SECTIONS) as SectionKey[]).find((key) => SECTIONS[key].some((name) => normalized.startsWith(name)));
}

function listItems(body: string): string[] {
	if (EMPTY_BODY.test(body.trim())) return [];
	return body
		.split("\n")
		.map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
		.filter((line) => line && !EMPTY_BODY.test(line));
}

export function parseIntent(text: string): Intent {
	const { fields, body } = splitFrontmatter(text);
	const title = (/^#\s+(.+)$/m.exec(body)?.[1] ?? "").replace(/^intent:\s*/i, "").trim();

	const sections: Partial<Record<SectionKey, string>> = {};
	let current: SectionKey | undefined;
	for (const line of body.split("\n")) {
		const heading = /^##\s+(.+)$/.exec(line);
		if (heading) {
			current = sectionKey(heading[1]);
			if (current) sections[current] = "";
		} else if (current) {
			sections[current] += `${line}\n`;
		}
	}
	const text_ = (key: SectionKey) => (sections[key] ?? "").trim();

	const checksBlock = /```(?:bash|sh)?\n([\s\S]*?)```/.exec(text_("checks"))?.[1] ?? "";
	const status = STATUSES.find((s) => s === fields.status) ?? "draft";
	return {
		status,
		created: fields.created || undefined,
		source: fields.source === "loop" ? "loop" : "user",
		title,
		problem: text_("problem"),
		outcomes: listItems(text_("outcome")),
		users: text_("users"),
		constraints: listItems(text_("constraints")),
		openQuestions: listItems(text_("questions")),
		checks: checksBlock.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
		missing: REQUIRED.filter((key) => !text_(key)),
	};
}

/** Sets the frontmatter status, adding a frontmatter if the file has none. */
export function setStatus(text: string, status: IntentStatus): string {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	if (!match) return `---\nstatus: ${status}\n---\n${text}`;
	const lines = match[1].split("\n");
	const index = lines.findIndex((line) => /^status:/.test(line));
	if (index >= 0) lines[index] = lines[index].replace(/^status:\s*[\w-]*/, `status: ${status}`);
	else lines.unshift(`status: ${status}`);
	return `---\n${lines.join("\n")}\n---\n${text.slice(match[0].length)}`;
}

export function slugify(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50)
		.replace(/-+$/, "");
}

export function intentTemplate(title: string, date: string): string {
	return `---
status: draft
created: ${date}
source: user
---
# ${title}

## Problema
Cosa oggi non si può fare, e perché è un problema.

## Outcome atteso
- Risultato osservabile e verificabile.

## Utenti e sistemi impattati
Chi usa il risultato; quali moduli o servizi tocca.

## Vincoli
- Limiti da rispettare (tecnici, sicurezza, tempi) e cosa è fuori scope.

## Domande aperte
- nessuna

## Verifica
\`\`\`bash
# facoltativa: comandi che devono passare, uno per riga
\`\`\`
`;
}

/** Intents in <cwd>/intents, newest first. */
export function listIntents(cwd: string): { file: string; intent: Intent }[] {
	const dir = join(cwd, INTENTS_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.reverse()
		.map((name) => ({ file: join(INTENTS_DIR, name), intent: parseIntent(readFileSync(join(dir, name), "utf8")) }));
}

const OPEN_ORDER: Record<string, number> = { "in-progress": 0, ready: 1, draft: 2 };

/** Picker rows for the open intents (in-progress, ready, draft; done/rejected hidden), newest first within each status. */
export function intentPickerItems(cwd: string): { value: string; label: string; description: string; preview: string }[] {
	return listIntents(cwd)
		.filter(({ intent }) => intent.status in OPEN_ORDER)
		.sort((a, b) => OPEN_ORDER[a.intent.status] - OPEN_ORDER[b.intent.status])
		.map(({ file, intent }) => ({
			value: file,
			label: intent.title || file,
			description: `${intent.status} · ${intent.outcomes.length} outcome · ${intent.openQuestions.length} domande aperte`,
			preview: [
				`# ${intent.title}`,
				"",
				"Outcome atteso:",
				...intent.outcomes.map((item) => `- ${item}`),
				...(intent.openQuestions.length > 0 ? ["", "Domande aperte:", ...intent.openQuestions.map((item) => `- ${item}`)] : []),
			].join("\n"),
		}));
}

/**
 * Lets the user pick an open intent in the modal picker and prefills `/goal @intents/<file>` (Enter starts it).
 * The picker is imported only here, so it costs nothing at startup. Returns false when there was nothing to show.
 */
export async function pickIntent(ctx: ExtensionContext): Promise<boolean> {
	const items = intentPickerItems(ctx.cwd);
	if (items.length === 0 || !ctx.hasUI) return false;
	const [{ pick }, { listSource }] = await Promise.all([import("../pi-picker/src/pick.ts"), import("../pi-picker/src/sources.ts")]);
	const previews = new Map(items.map((item) => [item.value, item.preview]));
	const chosen = await pick(ctx, { title: "Intent aperti — Invio prepara /goal", source: listSource(items, (item) => previews.get(item.value)) });
	if (chosen?.[0]) ctx.ui.setEditorText(`/goal @${chosen[0]}`);
	return true;
}

/** The newest intent with status in-progress, if any. */
export function activeIntent(cwd: string): { file: string; intent: Intent } | undefined {
	return listIntents(cwd).find(({ intent }) => intent.status === "in-progress");
}

/** Compact reminder of an intent, for the context after a compaction. Empty sections are left out. */
export function renderIntentReminder(file: string, intent: Intent): string {
	const list = (title: string, items: string[]) => (items.length > 0 ? [`${title}:`, ...items.map((item) => `- ${item}`), ""] : []);
	return [
		`Intent in corso (${file}), riportato dopo la compaction: è il riferimento del lavoro, rileggi il file se serve il dettaglio.`,
		"",
		`# ${intent.title || "(senza titolo)"}`,
		"",
		...list("Outcome atteso", intent.outcomes),
		...list("Vincoli", intent.constraints),
		...list("Domande aperte", intent.openQuestions),
		...list("Verifica", intent.checks),
	]
		.join("\n")
		.trimEnd();
}

/** Global flag read by pi-team: when set, its own input advisor stays quiet (one dialog per request). */
export const WORK_ADVISOR_FLAG = Symbol.for("pi-claude.work-advisor");

export function interviewPrompt(idea: string, date: string): string {
	return [
		`Aiutami a scrivere un intent.md per questa idea: "${idea}"`,
		"",
		"Un intent dice cosa si vuole, perché e con quali vincoli, PRIMA di qualunque design. Regole:",
		"- Leggi prima il codice e ricava da lì contesto, problema e utenti: chiedi solo ciò che il codice non dice.",
		"- Chiedi ciò che cambierebbe il risultato: comportamento atteso, limiti e soglie, formati, casi limite ed errori, cosa è fuori scope e, se si tratta di codice, nomi di file e funzioni e firme che l'utente si aspetta.",
		"- Fai al massimo 3 domande mirate per messaggio, numerate, con opzioni concrete quando aiutano; poi fermati e aspetta le risposte. Se hai il tool ask_user_question usalo, altrimenti chiedi in chat.",
		"- Scrivi sempre nella lingua dell'utente (qui italiano), anche le frasi di servizio; non commentare quali tool hai o non hai.",
		"- Non proporre tu design o soluzioni tecniche; ma nomi, firme e formati decisi dall'utente sono requisiti: riportali nell'intent.",
		"- Fermati appena non resta niente che cambierebbe il risultato (di solito 1-2 giri di domande).",
		"- Outcome atteso: punti osservabili e verificabili. Domande aperte: solo ciò che resta davvero non deciso.",
		"- Verifica: se emergono comandi che dimostrano il risultato (test, build), mettili; altrimenti lascia il blocco vuoto.",
		`- Alla fine scrivi il file con il tool write in ${INTENTS_DIR}/${date}-<slug>.md (slug breve, minuscolo, con trattini), con status: draft, poi mostrami il percorso e un riassunto di 2 righe.`,
		"",
		"Formato (rispetta titoli e frontmatter):",
		"",
		intentTemplate("<titolo>", date),
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	const advisorMode = (process.env.PI_INTENT_ADVISOR ?? "ask").toLowerCase();
	const today = () => new Date().toISOString().slice(0, 10);

	// Startup: point at the work in progress.
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const active = activeIntent(ctx.cwd);
		if (active) ctx.ui.notify(`Lavoro in corso: ${active.intent.title || active.file} → /goal resume`, "info");
	});

	// After a compaction the summary may drop constraints: put the active intent back in the context.
	pi.on("session_compact", (_event, ctx) => {
		const active = activeIntent(ctx.cwd);
		if (!active) return;
		pi.sendMessage({ customType: "intent-reminder", content: renderIntentReminder(active.file, active.intent), display: true }, { deliverAs: "nextTurn" });
	});

	// One advisor for every request: Pi directly, an intent first, or the team.
	if (advisorMode !== "off") {
		(globalThis as Record<symbol, unknown>)[WORK_ADVISOR_FLAG] = true;
		let askFirstPending = false;
		pi.on("before_agent_start", () => {
			if (!askFirstPending) return undefined;
			askFirstPending = false;
			return { message: { customType: "intent-ask-first", content: ASK_FIRST_HINT, display: false } };
		});
		pi.on("input", async (event, ctx) => {
			if (event.source !== "interactive" || event.streamingBehavior || !ctx.hasUI) return { action: "continue" };
			const text = event.text.trim();
			if (!text || text.startsWith("/") || /\bteam\b/i.test(text)) return { action: "continue" };

			const advice = adviseWork(text, {
				contextPercent: ctx.getContextUsage()?.percent,
				teamAvailable: pi.getAllTools().some((tool) => tool.name === "team"),
				hasActiveIntent: activeIntent(ctx.cwd) !== undefined,
			});
			if (advice.outcome === "direct") return { action: "continue" };
			// Vague request: no dialog, Pi just asks what it does not know before writing code.
			// The hint goes to the model as a hidden message of this turn: the user's own text stays as typed.
			if (advice.outcome === "ask") {
				askFirstPending = true;
				return { action: "continue" };
			}

			if (advice.outcome === "intent") {
				const accepted =
					advisorMode === "auto" ||
					(await ctx.ui.confirm(
						"Fissiamo prima l'intent?",
						`${formatWorkAdvice(advice)}\n\nSì: breve intervista (3-6 domande) e ${INTENTS_DIR}/<data>-<slug>.md, poi si lavora su quello.\nNo: Pi procede subito.`,
					));
				return accepted ? { action: "transform", text: interviewPrompt(text, today()), images: event.images } : { action: "continue" };
			}

			const choice = await ctx.ui.select(`Lavoro grande:\n${formatWorkAdvice(advice)}`, ["Intent e poi team", "Solo team", "Pi da solo"]);
			if (!choice || choice === "Pi da solo") return { action: "continue" };
			pi.events.emit("tool-groups:load", ["team"]);
			const teamInstruction = `Usa il tool team per questo lavoro.\n\n${event.text}`;
			if (choice === "Solo team") return { action: "transform", text: teamInstruction, images: event.images };
			const afterIntent = "\n\nQuando l'intent è scritto, usa il tool team per realizzarlo: pianifica a partire dall'intent (outcome = criteri, Verifica = controlli).";
			return { action: "transform", text: interviewPrompt(text, today()) + afterIntent, images: event.images };
		});
	}

	pi.registerCommand("intent", {
		description: "Scrive un intent.md con un'intervista (/intent <idea>) o elenca gli intent del progetto (/intent)",
		handler: async (args, ctx) => {
			const idea = args.trim();
			if (!idea) {
				// Open intents in the modal picker (Enter prefills /goal); otherwise the plain list.
				if (ctx.mode === "tui" && (await pickIntent(ctx))) return;
				const intents = listIntents(ctx.cwd);
				if (intents.length === 0) return ctx.ui.notify(`Nessun intent in ${INTENTS_DIR}/. Creane uno con /intent <idea>`, "info");
				const lines = intents.map(({ file, intent }) => {
					const questions = intent.openQuestions.length > 0 ? ` · ${intent.openQuestions.length} domande aperte` : "";
					return `${intent.status.padEnd(11)} ${intent.title || "(senza titolo)"} — ${file}${questions}`;
				});
				return ctx.ui.notify(lines.join("\n"), "info");
			}
			if (!ctx.isIdle()) return ctx.ui.notify("Pi è occupato: riprova /intent quando ha finito.", "warning");
			pi.sendUserMessage(interviewPrompt(idea, today()));
		},
	});
}
