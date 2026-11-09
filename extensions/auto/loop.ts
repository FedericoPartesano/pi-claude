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
import { buildPrompt, definePrompt, planPrompt, reviewPrompt } from "./prompts.ts";
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
}

export interface StepResult {
	ok: boolean;
	text: string;
	tokens: number;
	error?: string;
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

async function runStep(state: AutoState, deps: LoopDeps, phase: Phase, prompt: string): Promise<StepResult> {
	state.steps++;
	note(state, deps, `passo ${state.steps}: ${phase}`);
	deps.save(state);
	const readOnly = phase === "define" || phase === "plan" ? [] : state.frozen.map((path) => join(state.worktree, path)).filter((path) => existsSync(path));
	const result = await deps.step(state, { phase, prompt, readOnly });
	state.tokens += result.tokens;
	if (!result.ok) note(state, deps, `passo ${state.steps} fallito: ${result.error ?? "nessuna risposta"}`);
	return result;
}

const hashedFiles = (state: AutoState) => state.frozen.filter((path) => path !== REQUIREMENTS_FILE);

function tampered(state: AutoState): boolean {
	return !!state.checksHash && checksHash(state.requirements, state.worktree, hashedFiles(state)) !== state.checksHash;
}

async function refreshPasses(state: AutoState, deps: LoopDeps): Promise<void> {
	for (const item of state.requirements) item.passes = (await deps.check(item.check, state.worktree)).ok;
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
	const result = await runStep(state, deps, "define", definePrompt(state));
	const file = join(state.worktree, state.intent);
	if (existsSync(file) && /^## Outcome atteso/m.test(readFileSync(file, "utf8"))) {
		await commitAll(state, deps, "docs(auto): intent");
		state.phase = "plan";
		state.stall = 0;
		return;
	}
	noProgress(state, deps, `intent ${state.intent} non scritto${result.error ? `: ${result.error}` : ""}`);
}

async function plan(state: AutoState, deps: LoopDeps): Promise<void> {
	const result = await runStep(state, deps, "plan", planPrompt(state, state.lastError));
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
	state.frozen = [REQUIREMENTS_FILE, ...parsed.value.frozen.filter((path) => path !== REQUIREMENTS_FILE)];
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
	await runStep(state, deps, "build", buildPrompt(state, pending, state.errorFor === pending.id ? state.lastError : undefined));
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
	await runStep(state, deps, "review", reviewPrompt(state, state.base));
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

/** The run's outcome written into the intent on the branch (status done only when completed). */
export function reportSection(state: AutoState, approvals: string, now: number): string {
	const minutes = Math.round((now - state.started) / 60_000);
	const lines = [
		"## Esito auto mode",
		`- Arresto: ${state.stop?.reason ?? "in corso"} — ${state.stop?.detail ?? ""}`,
		`- Passi: ${state.steps} · token: ${state.tokens} · durata: ${minutes} min · branch \`${state.branch}\``,
		...state.requirements.map((item) => `- [${item.passes ? "x" : " "}] ${item.id}: ${item.descrizione} — check: \`${item.check}\``),
		`- Decisioni: \`${DECISIONS_FILE}\`${approvals ? ` · da approvare: \`${APPROVALS_FILE}\`` : ""}`,
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
