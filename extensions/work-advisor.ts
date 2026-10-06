/**
 * Work advisor: before a request starts, decides between Pi directly, an intent first, or the team.
 * Instant local heuristic (no model call, no tokens). Extends the pi-team advisor, which stays the
 * judge for "large job". Vague requests get "ask first" (a hint, measured +37 points of requirements met);
 * the full intent (interview + file) is proposed for large jobs.
 *
 * Not an extension: a module imported by extensions/intent.ts. It must be loaded from its real path
 * (settings.json `extensions`, or `pi -e`), because Pi does not resolve symlinks for relative imports.
 */
import { adviseTeam, countParts, type Advice } from "../pi-team/src/advisor.ts";

export type WorkOutcome = "direct" | "ask" | "intent" | "team";

export interface WorkAdvice {
	outcome: WorkOutcome;
	/** Intent score (the team decision has its own score in `team`). */
	score: number;
	reasons: string[];
	team: Advice;
}

export interface WorkContext {
	contextPercent?: number | null;
	/** The `team` tool is registered (pi-full). */
	teamAvailable: boolean;
	/** An intent is already in progress in this project. */
	hasActiveIntent: boolean;
}

/** Vague requests get the "ask first" hint (eval/intent-cases.mjs: 38% → 75% of hidden requirements met). */
export const ASK_THRESHOLD = 2;

/** Appended to vague requests: Pi asks what it does not know before writing code. No file, no dialog. */
export const ASK_FIRST_HINT =
	"Prima di scrivere codice: individua cosa la richiesta non specifica e cambierebbe il risultato (comportamento atteso, limiti e soglie, formati, casi limite, nomi di funzioni e file, cosa è fuori scope). Se c'è qualcosa, fai al massimo 3 domande mirate e fermati ad aspettare le risposte; se è tutto chiaro, procedi.";

// "I want / we should / it would be useful": wishes, not instructions.
// "Vorrei capire / sapere ..." is a question, not a wish.
const WISH_PATTERN = /\b(voglio|vorrei|vorremmo|vogliamo|dovrebbe|dovrebbero|dovremmo|mi serve|ci serve|ci servirebbe|servirebbe|sarebbe (utile|bello)|mi piacerebbe|i want|we need|we should|it would be nice)\b(?!\s+(capire|sapere|vedere|chiederti|una spiegazione|to know|to understand))/i;
// New capabilities rather than edits to something named.
const FEATURE_PATTERN = /\b(funzionalit[àa]|feature|nuov[oaie] (pagina|sezione|schermata|flusso|modulo|servizio)|sistema di|gestione (de|di)|integrazione|supporto (per|a|al|alla)|(aggiungere|implementare|introdurre|realizzare|sviluppare) (una|un|il|la|le|gli|lo|i)\b|login con|esportare|notifiche|dashboard|pagina di)/i;
// Precise anchors: paths, file names, code identifiers, backticks, error names, line numbers.
const ANCHOR_PATTERN = /`[^`]+`|[\w.-]+\/[\w./-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|cs|sql|json|md|yml|yaml|csv|log|html|css)\b|\b[a-z]+[A-Z]\w*\b|\b[a-z]+_[a-z_]+\b|\w+\(\)|\b\w*(?:Error|Exception)\b|\briga \d+|\bline \d+/g;
const QUESTION_PATTERN = /^\s*(perch[ée]|come|cosa|che cosa|quale|quali|dove|quando|quanto|quanti|why|how|what|where|which|spiega|spiegami|dimmi)\b|\?\s*$/i;
// Operational one-shots: run, show, read, small edits.
const SMALL_ACTION_PATTERN = /^\s*(rinomina|lancia|esegui|mostra|leggi|apri|stampa|elenca|cancella|elimina|correggi (il|lo|un) (typo|refuso)|sposta|formatta|run|show|rename|list)\b/i;
// Changes asked for without saying what "done" looks like: improve, fix "strange" results, "we need an export".
const VAGUE_CHANGE_PATTERN = /\b(miglior\w*|meglio|sistem(a|ia|iamo|are)\w*|strani?|strane|non (va|funziona)( bene)?|ottimizz\w*|aggiungiamo|serve|servono|export|semplific\w*|rivedere|rivediamo|rendere|rendi)\b/i;
const INTENT_PATH_PATTERN = /\bintents\/[\w.-]+/;

export function adviseWork(text: string, context: WorkContext): WorkAdvice {
	const team = adviseTeam(text, context.contextPercent);
	const advice = (outcome: WorkOutcome, score: number, reasons: string[]): WorkAdvice => ({ outcome, score, reasons, team });

	// Clearly large jobs: the team when it exists, otherwise at least fix the intent first.
	if (team.recommendTeam) {
		if (context.teamAvailable) return advice("team", team.score, team.reasons);
		if (!context.hasActiveIntent) return advice("intent", team.score, [...team.reasons, "lavoro grande: conviene fissare prima l'intent"]);
	}
	if (INTENT_PATH_PATTERN.test(text)) return advice("direct", 0, ["la richiesta parte già da un intent"]);
	if (context.hasActiveIntent) return advice("direct", 0, ["c'è già un intent in corso"]);

	const reasons: string[] = [];
	let score = 0;
	if (WISH_PATTERN.test(text)) (score += 2), reasons.push("descrive un desiderio, non un'istruzione");
	if (FEATURE_PATTERN.test(text)) (score += 2), reasons.push("chiede una funzionalità nuova");
	else if (VAGUE_CHANGE_PATTERN.test(text)) (score += 2), reasons.push("chiede un cambiamento senza dire com'è il risultato");
	const parts = countParts(text);
	if (parts >= 2) (score += 1), reasons.push(`${parts} risultati richiesti`);

	const anchors = text.match(ANCHOR_PATTERN)?.length ?? 0;
	if (anchors >= 2) (score -= 4), reasons.push("richiesta già precisa (file, funzioni, valori)");
	else if (anchors === 1) (score -= 1), reasons.push("cita un punto preciso del codice");
	else if (score > 0) (score += 1), reasons.push("nessun file o simbolo preciso");

	if (QUESTION_PATTERN.test(text) && !WISH_PATTERN.test(text)) (score -= 3), reasons.push("è una domanda");
	if (SMALL_ACTION_PATTERN.test(text)) (score -= 3), reasons.push("operazione puntuale");
	if (text.trim().length < 25) (score -= 2), reasons.push("richiesta molto breve");

	return advice(score >= ASK_THRESHOLD ? "ask" : "direct", score, reasons);
}

export function formatWorkAdvice(advice: WorkAdvice): string {
	return advice.reasons.map((reason) => `• ${reason}`).join("\n");
}
