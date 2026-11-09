/**
 * Auto mode state. The supervisor's own state lives outside the worktree (the child cannot touch it); what the
 * child writes (auto/requisiti.json) is untrusted input: validated against a schema, never executed as given
 * except the frozen checks, whose hash is fixed at the end of plan.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { PHASES, type Phase } from "./policy.ts";

export type StopReason =
	| "completato"
	| "niente-da-fare"
	| "stallo"
	| "stesso-errore"
	| "budget"
	| "tempo"
	| "passi"
	| "fermato"
	| "check-manomessi"
	| "piano-non-valido"
	| "errore";

export interface Requirement {
	id: string;
	descrizione: string;
	/** Shell command run by the supervisor in the worktree: exit 0 = requirement met. */
	check: string;
	/** Real-use proof written in the plan (N4): what the check exercises, in words. */
	prova: string;
	passes: boolean;
}

export interface AutoState {
	versione: 1;
	goal: string;
	slug: string;
	branch: string;
	repo: string;
	worktree: string;
	/** Commit the branch started from: the review reads base..HEAD. */
	base: string;
	intent: string;
	phase: Phase;
	started: number;
	deadline: number;
	/** 5h-window utilization when the run started (0..1), if known. */
	fiveHourStart?: number;
	steps: number;
	tokens: number;
	stall: number;
	lastError?: string;
	/** Requirement whose check produced lastError. */
	errorFor?: string;
	sameError: number;
	reviewed: boolean;
	checksHash?: string;
	/** Worktree-relative paths read-only from build on (requisiti.json and the plan's test files). */
	frozen: string[];
	requirements: Requirement[];
	model?: { provider: string; id: string };
	stop?: { reason: StopReason; detail: string; at: number };
	log: string[];
}

export const REQUIREMENTS_FILE = "auto/requisiti.json";
export const DECISIONS_FILE = "auto/decisioni.md";
export const APPROVALS_FILE = "auto/da-approvare.md";
const MAX_REQUIREMENTS = 30;

export function newState(fields: Pick<AutoState, "goal" | "slug" | "branch" | "repo" | "worktree" | "base" | "intent" | "started" | "deadline"> & Partial<AutoState>): AutoState {
	return { versione: 1, phase: "define", steps: 0, tokens: 0, stall: 0, sameError: 0, reviewed: false, frozen: [], requirements: [], log: [], ...fields };
}

/** Where the supervisor keeps the state of `slug`: next to the worktrees, never inside one. */
export function stateFile(home: string, slug: string): string {
	return join(home, `${slug}.json`);
}

export function saveState(file: string, state: AutoState): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, "\t")}\n`);
	renameSync(`${file}.tmp`, file);
}

export function loadState(file: string): AutoState | undefined {
	if (!existsSync(file)) return undefined;
	try {
		const state = JSON.parse(readFileSync(file, "utf8")) as AutoState;
		if (state.versione !== 1 || !PHASES.includes(state.phase) || typeof state.worktree !== "string") return undefined;
		return state;
	} catch {
		return undefined;
	}
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const str = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** Validates the plan written by the child: `{ requisiti: [...], congelati?: [paths] }`. */
export function parsePlan(text: string): Parsed<{ requirements: Requirement[]; frozen: string[] }> {
	let data: any;
	try {
		data = JSON.parse(text);
	} catch (error) {
		return { ok: false, reason: `JSON non valido: ${(error as Error).message}` };
	}
	const list = Array.isArray(data) ? data : data?.requisiti;
	if (!Array.isArray(list)) return { ok: false, reason: "manca l'array `requisiti`" };
	if (list.length > MAX_REQUIREMENTS) return { ok: false, reason: `troppi requisiti (${list.length} > ${MAX_REQUIREMENTS}): raggruppa` };
	const requirements: Requirement[] = [];
	const ids = new Set<string>();
	for (const [index, item] of list.entries()) {
		const where = `requisito ${index + 1}`;
		if (!item || typeof item !== "object") return { ok: false, reason: `${where}: non è un oggetto` };
		if (!(typeof item.id === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(item.id))) return { ok: false, reason: `${where}: id mancante o non valido` };
		if (ids.has(item.id)) return { ok: false, reason: `${where}: id ${item.id} ripetuto` };
		if (!str(item.descrizione, 600)) return { ok: false, reason: `${item.id}: descrizione mancante` };
		if (!str(item.check, 600)) return { ok: false, reason: `${item.id}: check mancante (comando che esce con 0 quando il requisito è soddisfatto)` };
		if (!str(item.prova, 600)) return { ok: false, reason: `${item.id}: prova d'uso reale mancante` };
		ids.add(item.id);
		requirements.push({ id: item.id, descrizione: item.descrizione.trim(), check: item.check.trim(), prova: item.prova.trim(), passes: false });
	}
	const frozen: string[] = [];
	for (const path of Array.isArray(data?.congelati) ? data.congelati : []) {
		if (typeof path !== "string" || isAbsolute(path)) return { ok: false, reason: `congelati: ${String(path)} deve essere un percorso relativo` };
		const clean = normalize(path);
		if (clean.startsWith("..")) return { ok: false, reason: `congelati: ${path} è fuori dal worktree` };
		frozen.push(clean);
	}
	return { ok: true, value: { requirements, frozen } };
}

/** Hash of what must not change after plan: checks (ids + commands) and the content of frozen files. */
export function checksHash(requirements: readonly Requirement[], worktree: string, frozen: readonly string[]): string {
	const hash = createHash("sha256");
	hash.update(JSON.stringify(requirements.map((item) => [item.id, item.check])));
	for (const path of [...frozen].sort()) {
		hash.update(`\0${path}\0`);
		try {
			hash.update(readFileSync(join(worktree, path)));
		} catch {
			hash.update("<missing>");
		}
	}
	return hash.digest("hex");
}
