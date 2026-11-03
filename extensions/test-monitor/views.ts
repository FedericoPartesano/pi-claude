/**
 * Reusable panel views for the live monitor (build, lint, install, tests…). Each view is a plain state record plus a
 * renderer returning three rows in the shared frame (render.ts `panel`): head (verdict, command, clock), body (the
 * view's own picture and counters), detail (latest item, or the outcome once finished). An adapter fills a state and
 * picks the `kind`; `renderView` draws it. To add a view: a state type, a renderer, one entry in `VIEWS`.
 */
import { C, SPINNER, bold, duration, fg, panel, renderTestMonitor, shownCommand, truncateToWidth, visibleWidth, type TestRun } from "./render.ts";

interface Common {
	/** The command as typed (shown in the head). */
	command: string;
	startedAt: number;
	endedAt?: number;
	/** Short noun for the head: "BUILD", "LINT", "INSTALL"… */
	title: string;
	/** The run failed (non-zero exit or errors found). */
	failed?: boolean;
}

/** Progress bar, for builds and anything with a known or unknown amount of work: percent, stage, current file. */
export interface BarView extends Common {
	kind: "bar";
	done: number;
	/** Known total (modules, files, steps); absent: an indeterminate sweeping bar. */
	total?: number;
	stage?: string;
	current?: string;
	errors: number;
	warnings: number;
}

export interface Issue {
	level: "error" | "warning";
	file?: string;
	line?: number;
	rule?: string;
	message: string;
}

/** Lint-style: files checked, counters, and the latest issues. */
export interface IssuesView extends Common {
	kind: "issues";
	files: number;
	totalFiles?: number;
	errors: number;
	warnings: number;
	issues: Issue[];
	current?: string;
}

/** Install-style: a feed of items with counters (added, removed, total) and the phase we are in. */
export interface FeedView extends Common {
	kind: "feed";
	items: number;
	added?: number;
	removed?: number;
	phase?: string;
	last?: string;
}

export type StepStatus = "todo" | "run" | "ok" | "fail";

/** Checklist of stages (typecheck → bundle → emit), for pipelines with a fixed list of steps. */
export interface StepsView extends Common {
	kind: "steps";
	steps: { name: string; status: StepStatus }[];
}

export interface TestsView {
	kind: "tests";
	run: TestRun;
}

export type ViewState = BarView | IssuesView | FeedView | StepsView | TestsView;
export type ViewKind = ViewState["kind"];

const done = (state: Common) => state.endedAt !== undefined;
const colorOf = (state: Common, warn = false) => (!done(state) ? C.cyan : state.failed ? C.err : warn ? C.warn : C.ok);

/** Head row shared by the views: `◈ BUILD RUNNING  <command>`, clock on the right. */
function head(state: Common, color: string, width: number, now: number, verdicts = ["RUNNING", "FAILED", "DONE"]): string {
	const verdict = !done(state) ? verdicts[0] : state.failed ? verdicts[1] : verdicts[2];
	const label = ` ${bold(fg(color, `◈ ${state.title} ${verdict}`))}  ${fg(C.dim, truncateToWidth(shownCommand(state.command), Math.max(8, width - 28)))}`;
	const clock = fg(C.dim, duration((state.endedAt ?? now) - state.startedAt));
	return panel(color, width).split(label, clock);
}

const spinner = (state: Common, frame: number, color: string) => (done(state) ? "" : ` ${fg(color, SPINNER[frame % SPINNER.length])}`);
const counter = (value: number, label: string, color: string) => (value > 0 ? fg(color, `${value} ${label}`) : fg(C.dim, `0 ${label}`));
const dot = fg(C.dim, " · ");

/** `█████░░░░░` of `cells` cells; `fraction` undefined sweeps a bright block back and forth. */
export function barCells(cells: number, fraction: number | undefined, frame: number, color: string): string {
	if (cells <= 0) return "";
	if (fraction === undefined) {
		const span = Math.max(1, cells - 3);
		const at = Math.abs(((frame % (span * 2)) + span * 2) % (span * 2) - span);
		return Array.from({ length: cells }, (_, i) => (i >= at && i < at + 3 ? fg(color, "█") : fg(C.faint, "░"))).join("");
	}
	const full = Math.round(Math.max(0, Math.min(1, fraction)) * cells);
	return fg(color, "█".repeat(full)) + fg(C.faint, "░".repeat(cells - full));
}

function renderBar(state: BarView, width: number, now: number, frame: number): string[] {
	const color = colorOf(state, state.warnings > 0);
	const { row, split } = panel(color, width);
	const fraction = state.total ? state.done / state.total : done(state) && !state.failed ? 1 : undefined;
	const percent = fraction === undefined ? "" : `${Math.min(100, Math.round(fraction * 100))}%`;
	const tally = [state.errors ? counter(state.errors, "errors", C.err) : "", state.warnings ? counter(state.warnings, "warnings", C.warn) : ""].filter(Boolean).join(dot);
	const right = [tally, percent ? fg(C.text, percent) : "", state.total ? fg(C.dim, `${Math.min(state.done, state.total)}/${state.total}`) : ""].filter(Boolean).join(dot);
	const room = Math.max(6, width - 6 - visibleWidth(right));
	const body = ` ${barCells(Math.min(room, 60), fraction, frame, color)}${spinner(state, frame, color)}`;
	const detail = done(state)
		? state.failed ? fg(C.err, `✖ ${state.errors ? `${state.errors} errors` : truncateToWidth(state.current ?? "failed", width - 8)}`) : fg(C.ok, `✔ finished${state.warnings ? ` with ${state.warnings} warnings` : ""}`)
		: state.current || state.stage
			? `${state.stage ? fg(C.dim, `${state.stage} `) : ""}${fg(C.text, truncateToWidth(state.current ?? "", width - 12 - (state.stage?.length ?? 0)))}`
			: fg(C.dim, "starting…");
	return [row(head(state, color, width, now)), row(split(body, right)), row(` ${detail}`)];
}

const place = (issue: Issue) => (issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : "");

function renderIssues(state: IssuesView, width: number, now: number, frame: number): string[] {
	const color = colorOf(state, state.warnings > 0);
	const { row, split } = panel(color, width);
	const files = `${state.files}${state.totalFiles ? `/${state.totalFiles}` : ""} files`;
	const left = ` ${counter(state.errors, "errors", C.err)}${dot}${counter(state.warnings, "warnings", C.warn)}${spinner(state, frame, color)}`;
	const worst = [...state.issues].reverse().find((issue) => issue.level === "error") ?? state.issues[state.issues.length - 1];
	const detail = done(state) && !state.errors && !state.warnings
		? fg(C.ok, "✔ clean")
		: worst
			? `${fg(worst.level === "error" ? C.err : C.warn, worst.level === "error" ? "✖ " : "⚠ ")}${fg(C.dim, place(worst) ? `${place(worst)} ` : "")}${fg(C.text, truncateToWidth(worst.message, Math.max(8, width - 8 - place(worst).length)))}${worst.rule ? fg(C.dim, ` ${worst.rule}`) : ""}`
			: state.current ? `${fg(C.dim, "checking ")}${fg(C.text, truncateToWidth(state.current, width - 14))}` : fg(C.dim, "checking…");
	return [row(head(state, color, width, now, ["RUNNING", "FOUND ISSUES", "CLEAN"])), row(split(left, fg(C.dim, files))), row(` ${truncateToWidth(detail, width - 3)}`)];
}

function renderFeed(state: FeedView, width: number, now: number, frame: number): string[] {
	const color = colorOf(state);
	const { row, split } = panel(color, width);
	const parts = [state.added !== undefined ? fg(C.ok, `+${state.added}`) : "", state.removed ? fg(C.err, `-${state.removed}`) : "", fg(C.text, `${state.items} packages`)].filter(Boolean);
	const phase = state.phase ? fg(C.cyan, state.phase) : fg(C.dim, done(state) ? "done" : "starting");
	const left = ` ${phase}${spinner(state, frame, color)}`;
	const detail = done(state)
		? state.failed ? fg(C.err, `✖ ${state.last ?? "install failed"}`) : fg(C.ok, `✔ ${state.items} packages${state.added !== undefined ? `, ${state.added} added` : ""}`)
		: state.last ? `${fg(C.dim, "last ")}${fg(C.text, truncateToWidth(state.last, width - 12))}` : fg(C.dim, "resolving…");
	return [row(head(state, color, width, now)), row(split(left, parts.join(dot))), row(` ${detail}`)];
}

const STEP_MARK: Record<StepStatus, (frame: number) => string> = {
	todo: () => fg(C.faint, "○"),
	run: (frame) => fg(C.cyan, SPINNER[frame % SPINNER.length]),
	ok: () => fg(C.ok, "●"),
	fail: () => fg(C.err, "✖"),
};

function renderSteps(state: StepsView, width: number, now: number, frame: number): string[] {
	const color = colorOf(state);
	const { row } = panel(color, width);
	const line = state.steps.map((step) => `${STEP_MARK[step.status](frame)} ${fg(step.status === "todo" ? C.faint : step.status === "run" ? C.text : C.dim, step.name)}`).join(fg(C.faint, "  ─  "));
	const finished = state.steps.filter((step) => step.status === "ok").length;
	const failedStep = state.steps.find((step) => step.status === "fail");
	const running = state.steps.find((step) => step.status === "run");
	const detail = done(state)
		? failedStep ? fg(C.err, `✖ failed at ${failedStep.name}`) : fg(C.ok, `✔ ${finished}/${state.steps.length} steps`)
		: running ? `${fg(C.dim, "now ")}${fg(C.text, running.name)}${fg(C.dim, ` · ${finished}/${state.steps.length}`)}` : fg(C.dim, "starting…");
	return [row(head(state, color, width, now)), row(` ${line}`), row(` ${detail}`)];
}

type Renderer<S> = (state: S, width: number, now: number, frame: number) => string[];

/** The registry: one renderer per kind. */
export const VIEWS: { [K in ViewKind]: Renderer<Extract<ViewState, { kind: K }>> } = {
	bar: renderBar,
	issues: renderIssues,
	feed: renderFeed,
	steps: renderSteps,
	tests: (state, width, now, frame) => renderTestMonitor(state.run, width, now, frame),
};

export function renderView(state: ViewState, width: number, now: number, frame: number): string[] {
	return (VIEWS[state.kind] as Renderer<ViewState>)(state, width, now, frame);
}

/** Empty states, so an adapter only sets what it knows. */
export const newBar = (command: string, startedAt: number, title = "BUILD"): BarView => ({ kind: "bar", command, startedAt, title, done: 0, errors: 0, warnings: 0 });
export const newIssues = (command: string, startedAt: number, title = "LINT"): IssuesView => ({ kind: "issues", command, startedAt, title, files: 0, errors: 0, warnings: 0, issues: [] });
export const newFeed = (command: string, startedAt: number, title = "INSTALL"): FeedView => ({ kind: "feed", command, startedAt, title, items: 0 });
export const newSteps = (command: string, startedAt: number, names: string[], title = "PIPELINE"): StepsView => ({ kind: "steps", command, startedAt, title, steps: names.map((name) => ({ name, status: "todo" as const })) });
