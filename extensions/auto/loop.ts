/**
 * The auto mode supervisor loop: pure code, no prompt. define → plan → build (one child per requirement) →
 * verify → review → ship. Completion is computed here from the frozen checks, never taken from model text.
 * Stop reasons are typed; stall thresholds after frankbria/ralph-claude-code (3 steps without progress, 5 with
 * the same error). Every side effect goes through `LoopDeps`, so the loop runs under test with a fake child.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setStatus } from "../intent.ts";
import { denyReason, type Phase } from "./policy.ts";
import type { StepKind } from "./skills.ts";
import type { DiaryEvent } from "./diary.ts";
import { docsDir, docsStatus, PROJECT_DOCS } from "./docs.ts";
import { buildPrompt, definePrompt, docsPrompt, planPrompt, reviewPrompt } from "./prompts.ts";
import { APPROVALS_FILE, checksHash, DECISIONS_FILE, parsePlan, REQUIREMENTS_FILE, type AutoState, type StopReason } from "./state.ts";

export const LIMITS = {
	/** Steps in a row without any change in the worktree. */
	stall: 3,
	/** Build steps in a row ending with the same check failure. */
	sameError: 5,
	/** Share of the 5h window this run may spend. */
	budget: 0.5,
	/** Absolute 5h-window utilization where every run stops. */
	window: 0.9,
	maxSteps: 60,
};

export interface StepRequest {
	phase: Phase;
	prompt: string;
	/** Absolute paths the child must not write (frozen files). */
	readOnly: string[];
	/** Skill selection input (auto/skills.ts): step kinds in priority order and the text triggers match on. */
	skills?: { kinds: StepKind[]; context: string };
}

export interface StepResult {
	ok: boolean;
	text: string;
	tokens: number;
	error?: string;
	/** Skill names given in full, and SKILL.md files the child read on its own. */
	skillsGiven?: string[];
	skillsRead?: string[];
	/** Extra tool groups given (auto/tools.ts) and extra tools actually called. */
	toolsGiven?: string[];
	toolsUsed?: string[];
}

export interface LoopDeps {
	step(state: AutoState, request: StepRequest): Promise<StepResult>;
	check(command: string, cwd: string): Promise<{ ok: boolean; output: string }>;
	git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }>;
	/** 5h-window utilization 0..1, if known. */
	usage(): number | undefined;
	now(): number;
	save(state: AutoState): void;
	stopped(): boolean;
	/** Live progress line (status bar). */
	progress?(state: AutoState, line: string): void;
	/** Diary event (cockpit): step start/end, check results, applied guidance. */
	event?(event: DiaryEvent): void;
	/** Resolves at once, or waits while the run is paused (cockpit). Called between steps only. */
	gate?(state: AutoState): Promise<void>;
}

const passing = (state: AutoState) => state.requirements.filter((item) => item.passes).length;

function note(state: AutoState, deps: LoopDeps, line: string): void {
	state.log.push(`${new Date(deps.now()).toISOString().slice(11, 19)} ${line}`);
	if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
	deps.progress?.(state, line);
}

function stop(state: AutoState, deps: LoopDeps, reason: StopReason, detail: string): void {
	if (state.stop) return;
	state.stop = { reason, detail, at: deps.now() };
	note(state, deps, `stop: ${reason} — ${detail}`);
}

export function limitReason(state: AutoState, deps: Pick<LoopDeps, "usage" | "now" | "stopped">): [StopReason, string] | undefined {
	if (deps.stopped()) return ["fermato", "fermato dall'utente"];
	if (deps.now() > state.deadline) return ["tempo", "tetto di tempo raggiunto"];
	if (state.steps >= LIMITS.maxSteps) return ["passi", `${LIMITS.maxSteps} passi`];
	const usage = deps.usage();
	if (usage !== undefined && usage >= LIMITS.window) return ["budget", `finestra 5h al ${Math.round(usage * 100)}%`];
	if (usage !== undefined && state.fiveHourStart !== undefined && usage - state.fiveHourStart >= LIMITS.budget - 1e-9)
		return ["budget", `spesa del ${Math.round((usage - state.fiveHourStart) * 100)}% della finestra 5h`];
	return undefined;
}

/**
 * Side-panel lines of a run (prototype chat): plain text, rebuilt only on loop events. `usage` is the 5h-window
 * utilization (0..1) if known; `last` the latest log line.
 */
export function panelLines(state: AutoState, usage: number | undefined, last = state.log[state.log.length - 1] ?? ""): string[] {
	const done = passing(state);
	const total = state.requirements.length;
	const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
	const lines = [state.stop ? `■ ${state.slug} · ${state.stop.reason}` : `▶ ${state.slug} · ${state.phase}`];
	lines.push(`passo ${state.steps}/${LIMITS.maxSteps}${total ? ` · requisiti ${done}/${total}` : ""}`);
	if (total) {
		const n = 16, f = Math.round((done / total) * n);
		lines.push(`${"▰".repeat(f)}${"▱".repeat(n - f)}`);
	}
	const next = state.requirements.find((item) => !item.passes);
	if (!state.stop && next && (state.phase === "build" || state.phase === "verify")) lines.push(`→ ${next.id} ${next.descrizione}`);
	const spent = usage !== undefined && state.fiveHourStart !== undefined ? ` · 5h +${Math.round((usage - state.fiveHourStart) * 100)}%/${Math.round(LIMITS.budget * 100)}%` : "";
	lines.push(state.stop ? `${state.stop.detail}` : `fino alle ${clock(state.deadline)}${spent}`);
	const risks = [state.stall ? `stallo ${state.stall}/${LIMITS.stall}` : "", state.sameError > 1 ? `stesso errore ${state.sameError}/${LIMITS.sameError}` : ""].filter(Boolean);
	if (risks.length) lines.push(`⚠ ${risks.join(" · ")}`);
	if (last && !state.stop) lines.push(last.replace(/^\d\d:\d\d:\d\d /, "").slice(0, 160));
	return lines;
}

function noProgress(state: AutoState, deps: LoopDeps, detail: string, reason: StopReason = "stallo"): void {
	state.stall++;
	note(state, deps, `nessun progresso (${state.stall}/${LIMITS.stall}): ${detail}`);
	if (state.stall >= LIMITS.stall) stop(state, deps, reason, detail);
}

async function head(state: AutoState, deps: LoopDeps): Promise<string> {
	return (await deps.git(state.worktree, ["rev-parse", "HEAD"])).out.trim();
}

/** Commits what the child left uncommitted. Returns true when a commit was made. */
async function commitAll(state: AutoState, deps: LoopDeps, message: string): Promise<boolean> {
	await deps.git(state.worktree, ["add", "-A"]);
	const staged = await deps.git(state.worktree, ["diff", "--cached", "--quiet"]);
	if (staged.ok) return false;
	return (await deps.git(state.worktree, ["commit", "-q", "--no-verify", "-m", message])).ok;
}

/** User notes (cockpit `:`) waiting for the next step: appended once at the end of the prompt, so the fixed prefix keeps its cache. */
export function withNotes(state: AutoState, deps: LoopDeps, prompt: string): string {
	const notes = state.notes?.splice(0) ?? [];
	if (!notes.length) return prompt;
	deps.event?.({ t: "cmd", at: deps.now(), cmd: "nota", text: notes.join(" | "), applied: true });
	note(state, deps, `nota dell'utente applicata (${notes.length})`);
	return `${prompt}\n\nNota dell'utente per questo passo (rispettala, non cambia i check congelati):\n${notes.map((n) => `- ${n}`).join("\n")}`;
}

async function runStep(state: AutoState, deps: LoopDeps, phase: Phase, prompt: string, kinds: StepKind[] = [phase as StepKind], context = state.goal): Promise<StepResult> {
	state.steps++;
	note(state, deps, `passo ${state.steps}: ${phase}`);
	prompt = withNotes(state, deps, prompt);
	deps.save(state);
	const started = deps.now();
	deps.event?.({ t: "step", at: started, n: state.steps, phase });
	const readOnly = phase === "define" || phase === "plan" ? [] : state.frozen.map((path) => join(state.worktree, path)).filter((path) => existsSync(path));
	const result = await deps.step(state, { phase, prompt, readOnly, skills: { kinds, context } });
	state.tokens += result.tokens;
	deps.event?.({ t: "end", at: deps.now(), n: state.steps, ok: result.ok, ms: deps.now() - started, tokens: result.tokens, text: result.text, error: result.error });
	const skills = (state.skills ??= { given: {}, read: {} });
	for (const name of result.skillsGiven ?? []) skills.given[name] = (skills.given[name] ?? 0) + 1;
	for (const name of result.skillsRead ?? []) skills.read[name] = (skills.read[name] ?? 0) + 1;
	if (result.toolsGiven?.length || result.toolsUsed?.length) {
		const tools = (state.tools ??= { given: {}, used: {} });
		for (const name of result.toolsGiven ?? []) tools.given[name] = (tools.given[name] ?? 0) + 1;
		for (const name of result.toolsUsed ?? []) tools.used[name] = (tools.used[name] ?? 0) + 1;
	}
	if (!result.ok) note(state, deps, `passo ${state.steps} fallito: ${result.error ?? "nessuna risposta"}`);
	return result;
}

const hashedFiles = (state: AutoState) => state.frozen.filter((path) => path !== REQUIREMENTS_FILE);

function tampered(state: AutoState): boolean {
	return !!state.checksHash && checksHash(state.requirements, state.worktree, hashedFiles(state)) !== state.checksHash;
}

async function refreshPasses(state: AutoState, deps: LoopDeps): Promise<void> {
	for (const item of state.requirements) {
		const result = await deps.check(item.check, state.worktree);
		item.passes = result.ok;
		deps.event?.({ t: "check", at: deps.now(), id: item.id, ok: result.ok, ...(result.ok ? {} : { out: result.output.slice(-600) }) });
	}
	writeRequirements(state);
}

function writeRequirements(state: AutoState): void {
	const file = join(state.worktree, REQUIREMENTS_FILE);
	let frozen: string[] = [];
	try {
		frozen = JSON.parse(readFileSync(file, "utf8")).congelati ?? [];
	} catch {}
	writeFileSync(file, `${JSON.stringify({ requisiti: state.requirements, congelati: frozen }, null, "\t")}\n`);
}

async function define(state: AutoState, deps: LoopDeps): Promise<void> {
	const file = join(state.worktree, state.intent);
	const written = () => existsSync(file) && /^## Outcome atteso/m.test(readFileSync(file, "utf8"));
	// Resumable: an intent already written is not written again.
	if (!written()) {
		const result = await runStep(state, deps, "define", definePrompt(state));
		if (!written()) return noProgress(state, deps, `intent ${state.intent} non scritto${result.error ? `: ${result.error}` : ""}`);
		await commitAll(state, deps, "docs(auto): intent");
		state.stall = 0;
	}
	await projectDocs(state, deps);
}

/**
 * The six project documents (docs.ts), checked on every run before planning. Missing ones are drafted by one step
 * (`stato: bozza`, choices in da-approvare.md) and the run goes on: the user reviews them at the end.
 */
async function projectDocs(state: AutoState, deps: LoopDeps): Promise<void> {
	const dir = docsDir(state.worktree);
	const missing = docsStatus(state.worktree, dir).manca;
	if (missing.length) {
		const result = await runStep(state, deps, "define", docsPrompt(state, dir, missing), ["docs"]);
		const still = docsStatus(state.worktree, dir).manca;
		if (still.length) return noProgress(state, deps, `documenti non scritti: ${still.map((doc) => doc.file).join(", ")}${result.error ? ` (${result.error})` : ""}`);
		await commitAll(state, deps, "docs(auto): bozze dei documenti di progetto");
		note(state, deps, `documenti scritti: ${missing.map((doc) => doc.file).join(", ")}`);
	}
	state.phase = "plan";
	state.stall = 0;
}

async function plan(state: AutoState, deps: LoopDeps): Promise<void> {
	const result = await runStep(state, deps, "plan", planPrompt(state, state.lastError, docsDir(state.worktree)));
	const file = join(state.worktree, REQUIREMENTS_FILE);
	const parsed = existsSync(file) ? parsePlan(readFileSync(file, "utf8")) : ({ ok: false, reason: `${REQUIREMENTS_FILE} non scritto${result.error ? ` (${result.error})` : ""}` } as const);
	const denied = parsed.ok ? parsed.value.requirements.map((item) => [item.id, denyReason(item.check, "build", state.worktree)]).find(([, reason]) => reason) : undefined;
	if (!parsed.ok || denied) {
		const reason = parsed.ok ? `check di ${denied![0]} non ammesso: ${denied![1]}` : parsed.reason;
		state.lastError = reason;
		noProgress(state, deps, reason, "piano-non-valido");
		return;
	}
	if (parsed.value.requirements.length === 0) {
		stop(state, deps, "niente-da-fare", "il piano non contiene requisiti");
		return;
	}
	state.requirements = parsed.value.requirements;
	// The project documents are frozen with the checks: a build step that disagrees writes da-approvare.md instead.
	const docs = PROJECT_DOCS.map((doc) => join(docsDir(state.worktree), doc.file)).filter((path) => existsSync(join(state.worktree, path)));
	state.frozen = [...new Set([REQUIREMENTS_FILE, ...parsed.value.frozen, ...docs])];
	state.checksHash = checksHash(state.requirements, state.worktree, hashedFiles(state));
	await refreshPasses(state, deps);
	await commitAll(state, deps, "chore(auto): piano e check congelati");
	const already = state.requirements.filter((item) => item.passes).map((item) => item.id);
	note(state, deps, `piano: ${state.requirements.length} requisiti${already.length ? `, già verdi: ${already.join(", ")}` : ""}`);
	state.lastError = undefined;
	state.stall = 0;
	state.phase = "build";
}

async function build(state: AutoState, deps: LoopDeps): Promise<void> {
	if (tampered(state)) return stop(state, deps, "check-manomessi", "check o file congelati cambiati dopo il piano");
	await refreshPasses(state, deps);
	const pending = state.requirements.find((item) => !item.passes);
	if (!pending) {
		state.phase = "verify";
		return;
	}
	const before = await head(state, deps);
	const retry = state.errorFor === pending.id && state.lastError !== undefined;
	const failure = retry ? state.lastError || "(il check è fallito senza output)" : undefined;
	const context = [state.goal, pending.descrizione, pending.prova, pending.check, designContext(state)].join("\n");
	await runStep(state, deps, "build", buildPrompt(state, pending, failure, docsDir(state.worktree)), retry ? ["retry", "build"] : ["build"], context);
	await commitAll(state, deps, `feat(auto): ${pending.id}`);
	if (tampered(state)) return stop(state, deps, "check-manomessi", `il passo su ${pending.id} ha cambiato check o file congelati`);
	const result = await deps.check(pending.check, state.worktree);
	pending.passes = result.ok;
	writeRequirements(state);
	if (result.ok) {
		note(state, deps, `${pending.id} verde (${passing(state)}/${state.requirements.length})`);
		await commitAll(state, deps, `chore(auto): ${pending.id} verde`);
		state.stall = 0;
		state.sameError = 0;
		state.lastError = undefined;
		return;
	}
	const tail = result.output.trim().slice(-1500);
	const key = tail.slice(-300).replace(/\d+(\.\d+)?\s*m?s\b/g, "");
	const previous = state.lastError?.slice(-300).replace(/\d+(\.\d+)?\s*m?s\b/g, "");
	state.sameError = state.errorFor === pending.id && previous === key ? state.sameError + 1 : 1;
	state.lastError = tail;
	state.errorFor = pending.id;
	if (state.sameError >= LIMITS.sameError) return stop(state, deps, "stesso-errore", `${pending.id}: stesso errore ${state.sameError} volte`);
	if ((await head(state, deps)) === before) noProgress(state, deps, `${pending.id}: nessun cambiamento nel worktree`);
	else state.stall = 0;
}

async function verify(state: AutoState, deps: LoopDeps): Promise<void> {
	if (tampered(state)) return stop(state, deps, "check-manomessi", "check o file congelati cambiati dopo il piano");
	await refreshPasses(state, deps);
	if (passing(state) < state.requirements.length) {
		state.phase = "build";
		return;
	}
	state.phase = state.reviewed ? "ship" : "review";
}

async function review(state: AutoState, deps: LoopDeps): Promise<void> {
	state.reviewed = true;
	const changed = (await deps.git(state.worktree, ["diff", "--name-only", `${state.base}..HEAD`])).out;
	const context = [state.goal, ...state.requirements.map((item) => item.descrizione), changed, designContext(state)].join("\n");
	await runStep(state, deps, "review", reviewPrompt(state, state.base), ["review"], context);
	await commitAll(state, deps, "refactor(auto): revisione");
	state.phase = "verify";
}

async function ship(state: AutoState, deps: LoopDeps): Promise<void> {
	await commitAll(state, deps, "chore(auto): ultimi file");
	stop(state, deps, "completato", `${state.requirements.length}/${state.requirements.length} requisiti verdi`);
}

const PHASE_RUN: Record<Phase, (state: AutoState, deps: LoopDeps) => Promise<void>> = { define, plan, build, verify, review, ship };

function readOptional(path: string): string {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

/** The design document as trigger context (UI skill), unless it says the design does not apply. */
function designContext(state: AutoState): string {
	try {
		const text = readFileSync(join(state.worktree, docsDir(state.worktree), "design.md"), "utf8").slice(0, 4000);
		return /non si applica/i.test(text) ? "" : text;
	} catch {
		return "";
	}
}

const counts = (map: Record<string, number>) => Object.entries(map).map(([name, n]) => `${name}×${n}`).join(", ") || "nessuna";

/** The run's outcome written into the intent on the branch (status done only when completed). */
export function reportSection(state: AutoState, approvals: string, now: number): string {
	const minutes = Math.round((now - state.started) / 60_000);
	const lines = [
		"## Esito auto mode",
		`- Arresto: ${state.stop?.reason ?? "in corso"} — ${state.stop?.detail ?? ""}`,
		`- Passi: ${state.steps} · token: ${state.tokens} · durata: ${minutes} min · branch \`${state.branch}\``,
		...state.requirements.map((item) => `- [${item.passes ? "x" : " "}] ${item.id}: ${item.descrizione} — check: \`${item.check}\``),
		`- Decisioni: \`${DECISIONS_FILE}\`${approvals ? ` · da approvare: \`${APPROVALS_FILE}\`` : ""}`,
		...(state.skills ? [`- Skill: date ${counts(state.skills.given)} · lette ${counts(state.skills.read)}`] : []),
		...(state.tools ? [`- Strumenti: dati ${counts(state.tools.given)} · usati ${counts(state.tools.used)}`] : []),
	];
	return lines.join("\n");
}

async function writeReport(state: AutoState, deps: LoopDeps): Promise<void> {
	const file = join(state.worktree, state.intent);
	if (!existsSync(file)) return;
	let text = readFileSync(file, "utf8").replace(/\n## Esito auto mode\n[\s\S]*?(?=\n## |$)/, "").trimEnd();
	if (state.stop?.reason === "completato") text = setStatus(text, "done");
	writeFileSync(file, `${text}\n\n${reportSection(state, readOptional(join(state.worktree, APPROVALS_FILE)), deps.now())}\n`);
	await commitAll(state, deps, `docs(auto): esito (${state.stop?.reason ?? "in corso"})`);
}

/** Runs (or resumes) the loop until a stop reason. Idempotent on resume: progress is re-read from the checks. */
export async function runAuto(state: AutoState, deps: LoopDeps): Promise<AutoState> {
	state.stop = undefined;
	while (!state.stop) {
		await deps.gate?.(state);
		const limit = limitReason(state, deps);
		if (limit) {
			stop(state, deps, limit[0], limit[1]);
			break;
		}
		try {
			await PHASE_RUN[state.phase](state, deps);
		} catch (error) {
			stop(state, deps, "errore", (error as Error).message ?? String(error));
		}
		deps.save(state);
	}
	try {
		await writeReport(state, deps);
	} catch (error) {
		note(state, deps, `esito non scritto: ${(error as Error).message}`);
	}
	deps.save(state);
	return state;
}
