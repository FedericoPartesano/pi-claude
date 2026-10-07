/** Local, model-free reading of a request (is it a code change? a read-only inquiry?) and of rule scope. */
import { RECALL_BUDGET_CHARS, RECALL_LIMIT, type Scored } from "./recall.ts";
import type { MemoryRecord } from "./store.ts";
import { strength } from "./strength.ts";

export type RequestKind = "edit" | "inquiry" | "other";
export type MemoryScope = "sempre" | "contesto";

const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Verbs that mean "change the code" by themselves. */
const STRONG_VERBS = "aggiungi aggiungere implementa implementare correggi correggere sistema sistemare modifica modificare rifattorizza rifattorizzare refactor fix sostituisci rinomina rimuovi cambia aggiorna estendi migra".split(" ");
/** Verbs that only mean it next to something code-like ("scrivi una poesia" does not). */
const WEAK_VERBS = "crea creare scrivi scrivere genera generare".split(" ");
const CODE_WORDS = /\b(funzion\w*|file|test|component\w*|class\w*|modul\w*|codice|script|endpoint|api|metodo|metodi|hook|query|tabell\w*|colonn\w*|migrazion\w*|handler|servizio|schermata|pagina|bug|errore|log|config\w*|comando|libreria|parser|routine)\b|[\w-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|json|sql|md|ya?ml)\b|[a-z]+[A-Z]\w+|\w+\/\w+/;

const INTERROGATIVE = /^(come|cosa|cos'|che|perche|quale|quali|quanto|quanti|quante|quanta|dove|quando|chi|c'e|ci sono|e possibile|si puo|posso|puoi spiegare|mi spieghi|spiega|spiegami|dimmi|mostrami|elenca|conta|descrivi|riassumi)\b/;
/** Questions about data or code content and general knowledge, answered without touching anything. */
const INQUIRY = [
	/\b(senza (modificar|toccar|cambiar)\w*|non (modificare|toccare|cambiare)\b[^.?!]*|rispondi solo)/,
	/^(spiega|spiegami|descrivi|riassumi|mostrami|elenca|conta)\b/,
	/\b(cosa significa|cos'e|che differenza|qual e la differenza|differenza tra|quante righe|quanti [^?]{0,60}\b(ci sono|contiene|ha)\b)/,
];

/** edit = a task that changes code; inquiry = read-only question or explanation; other = the rest. */
export function classifyRequest(prompt: string): RequestKind {
	const text = norm(prompt).trim().replace(/^(ciao|ok|allora|ora|poi|per favore|per piacere|grazie)[ ,.!:-]+/, "");
	if (INQUIRY.some((pattern) => pattern.test(text))) return "inquiry";
	if (INTERROGATIVE.test(text)) return "other";
	const words = new Set(text.split(/[^a-z0-9']+/));
	if (STRONG_VERBS.some((verb) => words.has(verb))) return "edit";
	if (WEAK_VERBS.some((verb) => words.has(verb)) && CODE_WORDS.test(prompt)) return "edit";
	return "other";
}

const EVERY = /\b(sempre|ogni|mai|tutti|tutte|ovunque|qualsiasi|qualunque|vietato|niente|nessun[ao]?)\b/;
/** Migration heuristic for records saved before `scope` existed. */
export function inferScope(type: string, text: string): MemoryScope {
	return (type === "correzione" || type === "preferenza") && EVERY.test(norm(text)) ? "sempre" : "contesto";
}

export const scopeOf = (record: Pick<MemoryRecord, "scope" | "type" | "text">): MemoryScope => record.scope ?? inferScope(record.type, record.text);

/** At most this many cross-cutting rules ride along with a code-change request (the rest of the slots go to relevant ones). */
export const ALWAYS_LIMIT = 3;

/** "sempre" records first (strongest first), then relevant hits, no duplicates, within the 5-memory limit. */
export function composeRecall(always: MemoryRecord[], hits: Scored[], limit = RECALL_LIMIT, budget = RECALL_BUDGET_CHARS): Scored[] {
	const out: Scored[] = always.slice(0, ALWAYS_LIMIT).map((record) => ({ record, score: 1 }));
	const seen = new Set(out.map((hit) => hit.record.id));
	for (const hit of hits) if (!seen.has(hit.record.id)) out.push(hit);
	// Trim whole memories from the tail until the lines fit (renderRecall would otherwise cut the last one mid-sentence).
	const header = 44;
	let used = header;
	const kept: Scored[] = [];
	for (const hit of out.slice(0, limit)) {
		const cost = `- [${hit.record.type}] ${hit.record.text}`.length + 1;
		if (kept.length > 0 && used + cost > budget) break;
		kept.push(hit);
		used += cost;
	}
	return kept;
}

/** The strongest active, non-pinned "sempre" records (pinned ones already sit in the system prompt). */
export function alwaysRules(records: MemoryRecord[], today: string): MemoryRecord[] {
	return records
		.filter((record) => record.status === "active" && !record.pinned && scopeOf(record) === "sempre")
		.sort((a, b) => strength(b, today) - strength(a, today) || b.confirmations - a.confirmations || a.id.localeCompare(b.id));
}
