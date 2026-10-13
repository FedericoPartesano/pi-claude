/**
 * What the user sees of the memory: the summary and rows of /memory, the actions on one memory, the status line for
 * the footer and panel, and the lasting chat entry written after /dream. Pure functions: the extension only wires them.
 */
import { addAvoid } from "./avoid.ts";
import type { MemoryRecord } from "./store.ts";

const PLURALS: Record<string, string> = {
	correzione: "correzioni",
	preferenza: "preferenze",
	decisione: "decisioni",
	fatto: "fatti",
	episodio: "episodi",
	nuovo: "nuovi",
	rinforzato: "rinforzati",
	unito: "uniti",
	aggiornato: "aggiornati",
	dimenticato: "dimenticati",
	superato: "superati",
	attivo: "attivi",
	ricordo: "ricordi",
	volta: "volte",
	sessione: "sessioni",
};
const count = (n: number, word: string) => `${n} ${n === 1 ? word : (PLURALS[word] ?? word)}`;

const isGlobal = (record: Pick<MemoryRecord, "id">) => record.id.startsWith("g:");

/** One line for the top of /memory: how many, of which kind, when /dream last ran and where they live. */
export function summarize(records: MemoryRecord[], info: { lastDream?: string; where?: string }): string {
	const active = records.filter((record) => record.status === "active");
	if (records.length === 0) return ["nessun ricordo · fai /dream per ricavarli dalle sessioni", info.where].filter(Boolean).join(" · ");
	const pinned = active.filter((record) => record.pinned).length;
	const superseded = records.length - active.length;
	const byType = new Map<string, number>();
	for (const record of active) byType.set(record.type, (byType.get(record.type) ?? 0) + 1);
	const types = [...byType].sort(([a], [b]) => a.localeCompare(b)).map(([type, n]) => count(n, type)).join(" · ");
	return [
		`${count(active.length, "attivo")} · ${pinned} 📌 · ${count(superseded, "superato")}`,
		types,
		info.lastDream ? `ultimo /dream ${info.lastDream}` : "",
		info.where ?? "",
	]
		.filter(Boolean)
		.join(" · ");
}

/** Row of the /memory list: 📌 pinned, ~ superseded, "· globale" for the personal store. */
export function recordLabel(record: MemoryRecord): string {
	const mark = record.status === "superseded" ? "~ " : record.pinned ? "📌 " : "";
	return `${mark}[${record.type}] ${record.text}${isGlobal(record) ? " · globale" : ""}`;
}

/** Preview pane of one memory. */
export function recordPreview(record: MemoryRecord): string {
	return [
		record.text,
		"",
		`tipo: ${record.type}${record.pinned ? " · 📌 fissato (sempre nel contesto)" : ""}${isGlobal(record) ? " · globale" : " · progetto"}`,
		record.entities.length ? `entità: ${record.entities.join(", ")}` : "",
		`confermato ${count(record.confirmations, "volta")} · creato ${record.created} · ultimo ${record.last}`,
		record.status === "superseded" ? `stato: superato${record.reason ? ` — ${record.reason}` : ""}` : "",
		record.scope === "sempre" ? "vale per ogni modifica del progetto" : "",
	]
		.filter((line, index) => line !== "" || index === 1)
		.join("\n");
}

export type MemoryAction = { kind: "pin" } | { kind: "edit"; text: string } | { kind: "supersede" } | { kind: "delete" } | { kind: "avoid"; query: string };

/** A new list with the action applied to the memory `id` (the input is never changed). */
export function applyAction(records: MemoryRecord[], id: string, action: MemoryAction, today = new Date().toISOString().slice(0, 10)): MemoryRecord[] {
	if (action.kind === "delete") return records.filter((record) => record.id !== id);
	return records.map((record) => {
		if (record.id !== id) return record;
		if (action.kind === "pin") return { ...record, pinned: !record.pinned };
		if (action.kind === "edit") return { ...record, text: action.text, last: today };
		if (action.kind === "avoid") return { ...record, avoid: addAvoid(record.avoid, action.query) };
		return { ...record, status: "superseded", pinned: false, reason: `segnato superato dall'utente il ${today}` };
	});
}

/** What the model suggests for a memory the user says fired wrongly. Nothing changes until the user confirms. */
export interface Proposal {
	/** One or two plain sentences: what went wrong and what is proposed. */
	summary: string;
	/** keep: leave as is · avoid: stop recalling it for requests like this one · edit: new text · supersede: mark outdated · delete. */
	action: "keep" | "avoid" | "edit" | "supersede" | "delete";
	/** The new text, only for edit. */
	text?: string;
}

/** Prompt that asks the model to judge a memory the user flagged. `request` is the request that brought it in, if known. */
export function fixPrompt(record: MemoryRecord, request: string | undefined, comment: string): string {
	return [
		"L'utente dice che un ricordo della memoria del progetto è stato richiamato per errore o è sbagliato. Decidi cosa fare e spiegalo.",
		"",
		`Ricordo [${record.id}] (${record.type}${record.pinned ? ", fissato" : ""}${record.status !== "active" ? ", superato" : ""}): ${record.text}`,
		request ? `Richiesta in cui è scattato: ${request}` : "Richiesta in cui è scattato: non nota.",
		`Commento dell'utente: ${comment}`,
		"",
		"Scegli UNA azione:",
		...(request ? ['- "avoid": il ricordo è valido ma non c\'entra con richieste come quella: non va più richiamato per richieste simili.'] : []),
		'- "edit": il ricordo è impreciso o incompleto: dai il testo corretto in "text" (stessa lingua, una frase, senza perdere negazioni, numeri, percorsi).',
		'- "supersede": il ricordo non è più vero.',
		'- "delete": il ricordo è sbagliato o inutile del tutto.',
		'- "keep": il ricordo era giusto, nessuna modifica.',
		`Nel dubbio scegli l'azione meno distruttiva.${request ? ' Non cancellare se basta "avoid".' : ""}`,
		'Rispondi SOLO con JSON: {"summary": "...", "action": "...", "text": "..."} ("text" solo per edit). "summary" in italiano, parole semplici, max 2 frasi.',
	].join("\n");
}

/** The model's reply as a Proposal; undefined when it cannot be read (an edit without text counts as unreadable). */
export function parseFixProposal(reply: string): Proposal | undefined {
	const match = /\{[\s\S]*\}/.exec(reply);
	if (!match) return undefined;
	try {
		const raw = JSON.parse(match[0]) as { summary?: unknown; action?: unknown; text?: unknown };
		const actions = ["keep", "avoid", "edit", "supersede", "delete"] as const;
		const action = actions.find((candidate) => candidate === raw.action);
		if (!action || typeof raw.summary !== "string" || !raw.summary.trim()) return undefined;
		const text = typeof raw.text === "string" ? raw.text.trim() : "";
		if (action === "edit" && !text) return undefined;
		return { summary: raw.summary.trim(), action, ...(action === "edit" ? { text } : {}) };
	} catch {
		return undefined;
	}
}

/** The store action for a proposal; undefined for keep. `request` is the request to remember for avoid. */
export function fixAction(proposal: Proposal, request: string | undefined): MemoryAction | undefined {
	switch (proposal.action) {
		case "avoid": return request ? { kind: "avoid", query: request } : undefined;
		case "edit": return { kind: "edit", text: proposal.text ?? "" };
		case "supersede": return { kind: "supersede" };
		case "delete": return { kind: "delete" };
		default: return undefined;
	}
}

/** Status text for the footer and the panel (setStatus "memory"); undefined when there is no memory. */
/** What the memory worker is doing, as it reports it (download, loading the model, vectors, index) or a failure. */
export type MemoryProgress =
	| { phase: "download"; loaded: number; total: number }
	| { phase: "load" }
	| { phase: "vectors"; done: number; total: number }
	| { phase: "index"; total: number }
	| { phase: "failed"; message: string }
	| { phase: "idle" };

const mb = (bytes: number) => Math.round(bytes / 1048576);

/** The status line for a progress event (footer and session panel). */
export function progressText(progress: MemoryProgress): string | undefined {
	switch (progress.phase) {
		// Short: the session panel is ~38 columns wide.
		case "download":
			// Config files of a few KB come first: only real downloads are shown.
			if (progress.total < 1048576) return "⠋ memoria: carico il modello…";
			return `⠋ memoria: modello ${Math.round((progress.loaded / progress.total) * 100)}% · ${mb(progress.loaded)}/${mb(progress.total)} MB`;
		case "load":
			return "⠋ memoria: carico il modello…";
		case "vectors":
			return `⠋ memoria: vettori ${progress.done}/${progress.total}`;
		case "index":
			return `⠋ memoria: indicizzo ${String(progress.total).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ricordi`;
		case "failed":
			return `⚠ memoria senza modello (${progress.message})`;
		default:
			return undefined;
	}
}

export function memoryStatus(state: { loading?: boolean; dreaming?: boolean; active?: number; pinned?: number; recalled?: number; busy?: string }): string | undefined {
	// What the worker reports (download, vectors, index) wins over the generic lines.
	if (state.busy) return state.busy;
	if (state.dreaming) return "⠋ consolido la memoria…";
	if (state.loading) return "⠋ carico la memoria…";
	if (!state.active) return undefined;
	const total = `${state.active}${state.pinned ? ` (${state.pinned} 📌)` : ""}`;
	if (state.recalled) return `◇ ${state.recalled} ${state.recalled === 1 ? "ricordo richiamato" : "ricordi richiamati"} · ${total}`;
	return `◇ ${count(state.active, "ricordo")}${state.pinned ? ` (${state.pinned} 📌)` : ""}`;
}

export interface DreamEntry {
	title: string;
	lines: string[];
	footer?: string;
}

/** The /dream result as a chat entry that stays (a notification disappears and leaves the user unsure). */
export function dreamEntry(
	counts: { added: number; reinforced: number; merged: number; updated: number; forgotten: number },
	lines: string[],
	totals: { active: number; pinned: number; pending?: number },
): DreamEntry {
	const parts = [
		`+${counts.added} ${counts.added === 1 ? "nuovo" : "nuovi"}`,
		counts.reinforced ? count(counts.reinforced, "rinforzato") : "",
		counts.merged ? count(counts.merged, "unito") : "",
		counts.updated ? count(counts.updated, "aggiornato") : "",
		counts.forgotten ? count(counts.forgotten, "dimenticato") : "",
		`${count(totals.active, "ricordo")}${totals.pinned ? ` (${totals.pinned} 📌)` : ""}`,
	].filter(Boolean);
	return {
		title: `Memoria aggiornata · ${parts.join(" · ")}`,
		lines,
		footer: `${totals.pending ? `restano ${count(totals.pending, "sessione")}: rilancia /dream · ` : ""}/memory per vederli`,
	};
}
