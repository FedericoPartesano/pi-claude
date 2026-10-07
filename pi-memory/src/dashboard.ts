/**
 * What the user sees of the memory: the summary and rows of /memoria, the actions on one memory, the status line for
 * the footer and panel, and the lasting chat entry written after /dream. Pure functions: the extension only wires them.
 */
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

/** One line for the top of /memoria: how many, of which kind, when /dream last ran and where they live. */
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

/** Row of the /memoria list: 📌 pinned, ~ superseded, "· globale" for the personal store. */
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

export type MemoryAction = { kind: "pin" } | { kind: "edit"; text: string } | { kind: "supersede" } | { kind: "delete" };

/** A new list with the action applied to the memory `id` (the input is never changed). */
export function applyAction(records: MemoryRecord[], id: string, action: MemoryAction, today = new Date().toISOString().slice(0, 10)): MemoryRecord[] {
	if (action.kind === "delete") return records.filter((record) => record.id !== id);
	return records.map((record) => {
		if (record.id !== id) return record;
		if (action.kind === "pin") return { ...record, pinned: !record.pinned };
		if (action.kind === "edit") return { ...record, text: action.text, last: today };
		return { ...record, status: "superseded", pinned: false, reason: `segnato superato dall'utente il ${today}` };
	});
}

/** Status text for the footer and the panel (setStatus "memory"); undefined when there is no memory. */
export function memoryStatus(state: { loading?: boolean; dreaming?: boolean; active?: number; pinned?: number; recalled?: number }): string | undefined {
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
		footer: `${totals.pending ? `restano ${count(totals.pending, "sessione")}: rilancia /dream · ` : ""}/memoria per vederli`,
	};
}
