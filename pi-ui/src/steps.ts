/**
 * The steps of a turn, one row each (Neon Night principles 2-3): icon · phrase · tool (≥ 100 columns) · argument ·
 * result. Pi draws a blank line before every tool row unless the row draws nothing, so index.ts lets the first tool row
 * of a turn draw the whole list and the others draw nothing.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { diffCounts, parsePatch, renderDiff } from "./diff.ts";
import { C, bg, bold, fg, fit, pad } from "./palette.ts";
import { phrase } from "./phrases.ts";
import { SPINNER } from "./status-bar.ts";
import { checkOutcome, failingTests } from "./test-output.ts";

export interface Step {
	id: string;
	tool: string;
	args: Record<string, unknown>;
	done?: boolean;
	error?: boolean;
	/** Right column: "31 righe", "+1 -1", "13 pass", "2 falliti su 13". */
	summary?: { text: string; color: string };
	output?: string;
	details?: { patch?: string };
	pass?: number;
}

/** Records a finished step: error from the exit code and from test counts, summary for the right column. */
export function completeStep(step: Step, result: { output: string; isError: boolean; details?: { patch?: string } }): Step {
	const output = result.output.trim();
	const isTestRun = step.tool === "bash" && /test/.test(phrase("bash", step.args).text);
	const outcome = step.tool === "bash" ? checkOutcome(output, result.isError, isTestRun) : { failed: result.isError };
	let summary: Step["summary"];
	if (outcome.failed && "fail" in outcome && outcome.fail) summary = { text: `${outcome.fail} falliti su ${(outcome.pass ?? 0) + outcome.fail}`, color: C.err };
	else if (outcome.failed) summary = { text: "✗ errore", color: C.err };
	else if ("pass" in outcome && outcome.pass !== undefined) summary = { text: `${outcome.pass} pass`, color: C.ok };
	else if (step.tool === "edit" && result.details?.patch) {
		const { added, removed } = diffCounts(result.details.patch);
		summary = { text: `${fg(C.add, `+${added}`)} ${fg(C.del, `-${removed}`)}`, color: C.text };
	} else if (step.tool === "write") summary = { text: `+${String(step.args.content ?? "").split("\n").length}`, color: C.add };
	else if (step.tool === "read" || step.tool === "bash") summary = { text: `${output ? output.split("\n").length : 0} righe`, color: C.dim };
	else summary = { text: "fatto", color: C.dim };
	return { ...step, done: true, error: outcome.failed, summary, output, details: result.details, pass: "pass" in outcome ? outcome.pass : undefined };
}

export function stepRow(step: Step, width: number, frame: number, running: boolean): string {
	const { text, arg } = phrase(step.tool, step.args);
	const icon = step.done ? (step.error ? fg(C.err, "✗") : fg(C.ok, "✓")) : running ? fg(C.cyan, SPINNER[frame % SPINNER.length]) : fg(C.faint, "○");
	const name = step.done ? fg(step.error ? C.err : C.text, text) : running ? bold(fg(C.cyan, text)) : fg(C.dim, text);
	const right = step.summary ? fg(step.summary.color, step.summary.text) : running ? fg(C.cyan, "…") : "";
	const nameWidth = Math.min(30, Math.max(18, Math.floor(width * 0.28)));
	const narrow = width < 60;
	const tool = width >= 100 ? fg(C.faint, pad(step.tool.slice(0, 7), 8)) : "";
	const argWidth = Math.max(0, width - 4 - nameWidth - visibleWidth(tool) - visibleWidth(right) - 2);
	const left = `  ${icon} ${narrow ? name : pad(truncateToWidth(name, nameWidth - 1), nameWidth)}${narrow ? "" : `${tool}${fg(C.text, truncateToWidth(arg, argWidth))}`}`;
	const row = fit(left, right ? `${right} ` : "", width);
	return running ? bg(C.panel, row) : row;
}

/** Files a turn changed (edit/write and bash edits), for the summary line. */
function changedFiles(turn: Step[]): number {
	const files = new Set<string>();
	for (const step of turn) {
		if ((step.tool === "edit" || step.tool === "write") && step.args.path) files.add(String(step.args.path));
		const bash = step.tool === "bash" ? /^(?:Modifico|Scrivo) (\S+)/.exec(phrase("bash", step.args).text) : null;
		if (bash) files.add(bash[1]);
	}
	return files.size;
}

const detail = (text: string, color: string, width: number) => truncateToWidth(`    ${fg(C.faint, "│")} ${fg(color, text)}`, width);

/** Output under a step: the diff of an edit, the failing tests of a failed check, or the last lines of the output. */
function stepDetails(step: Step, width: number, expanded: boolean): string[] {
	if (step.error) {
		const failures = failingTests(step.output ?? "");
		if (failures.length && !expanded) return failures.slice(0, 4).map((failure) => detail(`${fg(C.err, "✗")} ${fg(C.text, failure)}`, C.text, width));
		return (step.output ?? "").split("\n").slice(expanded ? -12 : -6).map((line) => detail(line, C.err, width));
	}
	if (!expanded) return [];
	if (step.tool === "edit" && step.details?.patch) return renderDiff(parsePatch(step.details.patch), width, 6);
	const lines = (step.output ?? "").split("\n").filter(Boolean);
	return (step.tool === "bash" ? lines.slice(-10) : lines.slice(0, 10)).map((line) => detail(line, C.dim, width));
}

export function renderTurn(turn: Step[], width: number, options: { expanded: boolean; finished: boolean; frame: number }): string[] {
	const last = turn[turn.length - 1];
	if (options.finished && !options.expanded && turn.length > 0 && !last?.error) {
		const tests = [...turn].reverse().find((step) => step.pass !== undefined)?.pass;
		const files = changedFiles(turn);
		const parts = [`${turn.length} ${turn.length === 1 ? "passo" : "passi"}`, `${files} file`, ...(tests !== undefined ? [fg(C.ok, `${tests} test ok`)] : [])];
		return [fit(`  ${fg(C.ok, "✓")} ${fg(C.text, parts.join(fg(C.faint, " · ")))}`, `${fg(C.faint, "▸ ctrl+o")} ${fg(C.dim, "dettagli")} `, width)];
	}
	return turn.flatMap((step) => [stepRow(step, width, options.frame, !step.done && !options.finished), ...stepDetails(step, width, options.expanded)]);
}
