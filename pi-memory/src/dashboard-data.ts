/**
 * Data behind the memory dashboard: the history of /dream runs and of recalls (append-only logs next to the store),
 * recall statistics, and the prompt that lets the model answer questions using only the memories.
 */
import { appendFileSync, statSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryAction } from "./dashboard.ts";
import type { MemoryRecord } from "./store.ts";

export interface DreamRun {
	at: string;
	date: string;
	scope: "progetto" | "globale";
	counts: { added: number; reinforced: number; merged: number; updated: number; forgotten: number };
	lines: string[];
	sessions?: number;
	tokens?: number;
}

export interface RecallEvent {
	at: string;
	query: string;
	hits: { id: string; score: number }[];
	ms: number;
}

export interface SearchHit {
	record: MemoryRecord;
	score: number;
}

const DREAM_LOG = "dream-log.jsonl";
const RECALL_LOG = "recall-events.jsonl";

/** JSON lines of a file, newest first; corrupt lines are skipped (a crash mid-write must not hide the rest). */
function readLines<T>(file: string): T[] {
	if (!existsSync(file)) return [];
	const items: T[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			items.push(JSON.parse(line) as T);
		} catch {
			// skip
		}
	}
	return items.reverse();
}

export function appendDreamRun(dir: string, run: DreamRun): void {
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, DREAM_LOG), `${JSON.stringify(run)}\n`);
}

export const readDreamRuns = (dir: string): DreamRun[] => readLines<DreamRun>(join(dir, DREAM_LOG));

/** One line per request; only the last `max` are kept (the file is rewritten when it grows past the cap). */
/** Lines of each recall log, counted once per process: the log is read back only when it must be trimmed. */
const logLines = new Map<string, number>();

export function appendRecallEvent(dir: string, event: RecallEvent, max = 2000): void {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, RECALL_LOG);
	let lines = logLines.get(file);
	if (lines === undefined) lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).length : 0;
	appendFileSync(file, `${JSON.stringify(event)}\n`);
	lines++;
	// Trimmed to the newest `max` once it holds twice as many (reading it on every request cost the UI thread).
	if (lines > max * 2) {
		const kept = readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).slice(-max);
		writeFileSync(file, `${kept.join("\n")}\n`);
		lines = kept.length;
	}
	logLines.set(file, lines);
}

/**
 * Usage of a request (the memories it recalled): in the project's log, and the personal ("g:") ones in the global
 * store's log too, so a /dream --global sees personal memories used in any project.
 */
export function logUsage(dirs: { project: string; global?: string }, event: RecallEvent): void {
	appendRecallEvent(dirs.project, event);
	const personal = event.hits.filter((hit) => hit.id.startsWith("g:"));
	if (dirs.global && personal.length) appendRecallEvent(dirs.global, { ...event, hits: personal });
}

export const readRecallEvents = (dir: string): RecallEvent[] => readLines<RecallEvent>(join(dir, RECALL_LOG));

/** Recalls today and in total, and the 5 memories recalled most often (unknown ids ignored). */
export function recallStats(events: RecallEvent[], records: MemoryRecord[], today: string): { today: number; total: number; top: { record: MemoryRecord; count: number }[] } {
	const counts = new Map<string, number>();
	for (const event of events) for (const hit of event.hits) counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1);
	const byId = new Map(records.map((record) => [record.id, record]));
	const top = [...counts]
		.filter(([id]) => byId.has(id))
		.sort((a, b) => b[1] - a[1] || records.findIndex((record) => record.id === a[0]) - records.findIndex((record) => record.id === b[0]))
		.slice(0, 5)
		.map(([id, count]) => ({ record: byId.get(id)!, count }));
	return { today: events.filter((event) => event.at.startsWith(today)).length, total: events.length, top };
}

/** Prompt for a question about the memory: the model may use only these memories and cites them as [r12]. */
export function answerPrompt(question: string, hits: SearchHit[]): string {
	const memories = hits.length
		? hits.map(({ record }) => `[${record.id}] (${record.type}${record.pinned ? ", fissato" : ""}${record.status !== "active" ? `, superato${record.reason ? `: ${record.reason}` : ""}` : ""}) ${record.text}`).join("\n")
		: "(nessun ricordo pertinente trovato)";
	return [
		"Rispondi alla domanda usando solo questi ricordi del progetto. Non aggiungere conoscenze esterne.",
		"Cita i ricordi che usi con il loro id tra parentesi quadre, per esempio [r12]. I ricordi superati valgono come storia, non come regola attuale.",
		"Se i ricordi non bastano a rispondere, dillo chiaramente: \"La memoria non contiene questa informazione.\" Rispondi in italiano, in breve.",
		"",
		"Ricordi:",
		memories,
		"",
		`Domanda: ${question}`,
	].join("\n");
}

/** What the memory extension gives the dashboard UI. */
export interface MemoryDashboardSource {
	load(): { records: MemoryRecord[]; runs: DreamRun[]; events: RecallEvent[]; lastDream?: string; where: string };
	/** Local recall (no tokens): every match with its score, superseded ones included and marked as such. */
	search(question: string): Promise<SearchHit[]>;
	/** The model's answer, streamed (text so far at every delta). */
	answer(question: string, hits: SearchHit[], onText: (textSoFar: string) => void, signal?: AbortSignal): Promise<string>;
	act(id: string, action: MemoryAction): Promise<void>;
}
