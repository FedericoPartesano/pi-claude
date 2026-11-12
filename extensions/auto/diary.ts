/**
 * Auto mode diary: one compact JSON line per event, next to the state file (`<slug>.eventi.jsonl`). The cockpit view of the
 * prototype chat reads it (and the state JSON) straight from disk, so no RPC traffic carries the data. Outputs are cut:
 * the diary is for understanding a run, not for replaying it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type DiaryEvent =
	| { t: "step"; at: number; n: number; phase: string }
	| { t: "tool"; at: number; n: number; name: string; arg: string }
	| { t: "end"; at: number; n: number; ok: boolean; ms: number; tokens: number; text: string; error?: string }
	| { t: "check"; at: number; id: string; ok: boolean; out?: string }
	| { t: "cmd"; at: number; cmd: "pausa" | "riprendi" | "nota" | "stop"; text?: string; applied?: boolean };

export const diaryFile = (stateJson: string): string => stateJson.replace(/\.json$/, ".eventi.jsonl");

const MAX_TEXT = 2000;
const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Short, single-line argument of a tool call (path, command, pattern). */
export function toolArg(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	const value = a.path ?? a.file_path ?? a.command ?? a.pattern ?? a.query ?? a.url ?? Object.values(a).find((v) => typeof v === "string") ?? "";
	return cut(String(value).replace(/\s+/g, " ").trim(), 120);
}

export function appendEvent(file: string, event: DiaryEvent): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
		const e = event as Record<string, unknown>;
		if (typeof e.text === "string") e.text = cut(e.text, MAX_TEXT);
		if (typeof e.out === "string") e.out = cut(e.out, MAX_TEXT);
		appendFileSync(file, `${JSON.stringify(e)}\n`);
	} catch {
		// the diary never stops a run
	}
}

/** Parses the diary text; a last line without "\n" may be half written: ignored until the next event completes it. */
export function parseDiary(text: string): DiaryEvent[] {
	const lines = text.split("\n");
	if (!text.endsWith("\n")) lines.pop();
	const events: DiaryEvent[] = [];
	for (const line of lines) {
		if (!line) continue;
		try {
			const e = JSON.parse(line);
			if (e && typeof e.t === "string") events.push(e);
		} catch {
			// a corrupted line is skipped, the rest stays readable
		}
	}
	return events;
}

export function readDiary(file: string): DiaryEvent[] {
	if (!existsSync(file)) return [];
	try {
		return parseDiary(readFileSync(file, "utf8"));
	} catch {
		return [];
	}
}
