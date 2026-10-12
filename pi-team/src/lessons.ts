/**
 * What the team learns across runs, per project, without asking a model: checks that failed at the first
 * attempt, tasks too large for their role's token budget, checks broken before the team started, reviewer
 * requests, files changed outside the declared scope, tasks never completed.
 *
 * Stored in ~/.pi/agent/team/lessons/<project>.jsonl (append-only, trimmed). The latest record for a key
 * wins: a check that was broken and is now fixed stops being a lesson.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { TeamReport } from "./orchestrator.ts";

export type LessonKind = "retry" | "budget" | "preexisting" | "fixed" | "review" | "scope" | "failed";

export interface Lesson {
	at: string;
	kind: LessonKind;
	/** Same key = same lesson: the latest record replaces older ones. */
	key: string;
	text: string;
	goal?: string;
}

export const LESSONS_DIRECTORY = join(homedir(), ".pi/agent/team/lessons");
const MAX_RECORDS = 60;

export function lessonsFile(cwd: string, directory = LESSONS_DIRECTORY): string {
	let path = cwd;
	try {
		path = realpathSync(cwd);
	} catch {}
	const hash = createHash("sha1").update(path).digest("hex").slice(0, 10);
	return join(directory, `${basename(path).replace(/[^\w.-]/g, "_")}-${hash}.jsonl`);
}

const clip = (text: string, max: number) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const keyOf = (text: string) => createHash("sha1").update(text.toLowerCase().replace(/\d+/g, "#")).digest("hex").slice(0, 12);

/** The lessons a finished run teaches. */
export function deriveLessons(report: TeamReport, now = new Date()): Lesson[] {
	const at = now.toISOString();
	const goal = clip(report.goal, 120);
	const lessons: Lesson[] = [];
	const add = (kind: LessonKind, key: string, text: string) => lessons.push({ at, kind, key, text, goal });

	for (const task of report.tasks) {
		const first = task.failures[0];
		if (task.status === "done" && first) {
			add("retry", `retry:${keyOf(first)}`, `"${clip(task.title, 60)}" (${task.role}) non ha passato i controlli al primo tentativo: ${clip(first, 200)}. Verifica questo punto prima di consegnare.`);
		}
		if (task.status !== "done" && task.status !== "skipped") {
			add("failed", `failed:${keyOf(task.title)}`, `"${clip(task.title, 60)}" (${task.role}) non completato dopo ${task.attempts} tentativi${first ? `; errore: ${clip(task.failures.at(-1)!, 200)}` : ""}. Dividilo o chiarisci le istruzioni.`);
		}
		if (task.runs.some((run) => /budget di token/.test(run.error ?? ""))) {
			add("budget", `budget:${task.role}`, `Un compito di ${task.role} ha superato il budget di token del ruolo: in questo progetto dai a ${task.role} compiti più piccoli.`);
		}
	}
	const passingNow = new Set(report.finalVerify.filter((result) => result.ok).map((result) => result.command));
	for (const command of report.preexistingFailures) {
		if (passingNow.has(command)) add("fixed", `pre:${command}`, `\`${command}\` ora passa.`);
		else add("preexisting", `pre:${command}`, `\`${command}\` fallisce già nel progetto, indipendentemente dal team: usa controlli più mirati.`);
	}
	if (report.review.verdict === "changes" && report.review.notes) {
		add("review", `review:${keyOf(report.review.notes)}`, `Il revisore ha chiesto: ${clip(report.review.notes, 240)}`);
	}
	if (report.scopeWarnings.length) {
		add("scope", `scope:${report.scopeWarnings.join(",")}`, `Sono cambiati file non dichiarati da nessun compito (${report.scopeWarnings.slice(0, 5).join(", ")}): dichiarali nei \`files\` del compito che li tocca.`);
	}
	return lessons;
}

function readRecords(file: string): Lesson[] {
	if (!existsSync(file)) return [];
	const records: Lesson[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const record = JSON.parse(line) as Lesson;
			if (record.key && record.text) records.push(record);
		} catch {}
	}
	return records;
}

/** Current lessons of the project, newest first; a key's latest record wins and "fixed" records cancel. */
export function loadLessons(cwd: string, file = lessonsFile(cwd)): Lesson[] {
	const latest = new Map<string, Lesson>();
	for (const record of readRecords(file)) latest.set(record.key, record);
	return [...latest.values()].filter((lesson) => lesson.kind !== "fixed").sort((a, b) => b.at.localeCompare(a.at));
}

export function saveLessons(cwd: string, lessons: Lesson[], file = lessonsFile(cwd)): void {
	if (lessons.length === 0) return;
	mkdirSync(dirname(file), { recursive: true });
	const records = [...readRecords(file), ...lessons].slice(-MAX_RECORDS);
	writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

/** The lessons as a prompt section; empty when there are none. */
export function formatLessons(lessons: Lesson[], max = 6): string {
	if (lessons.length === 0) return "";
	return `Lezioni dai lavori precedenti del team in questo progetto:\n${lessons.slice(0, max).map((lesson) => `- ${lesson.text}`).join("\n")}`;
}
