/** One-line footer: session state (goal/loop/team), project and git, usage. Replaces Pi's footer. */
import { C, bold, fg, fit } from "./palette.ts";

export interface FooterInfo {
	/** Texts from ctx.ui.setStatus(): "goal", "loop" and "team" are shown, the rest is Pi's or other extensions'. */
	statuses: ReadonlyMap<string, string>;
	project: string;
	branch?: string;
	changes: number;
	fiveHour?: number;
	overage?: boolean;
	contextPercent?: number;
	model: string;
	thinking: string;
}

const SESSION = [
	["goal", "GOAL", C.mag],
	["loop", "LOOP", C.cyan],
	["team", "TEAM", C.yel],
] as const;

const percent = (value: number | undefined, scale = 1) => (value === undefined ? "–" : `${Math.round(value * scale)}%`);

export function renderFooter(info: FooterInfo, width: number): string {
	const session = SESSION.flatMap(([key, tag, color]) => {
		const text = info.statuses.get(key)?.replace(new RegExp(`^${key}\\s*`, "i"), "");
		return text ? [`${bold(fg(color, tag))} ${fg(C.text, text)}`] : [];
	}).join("  ");
	const where = `${bold(fg(C.text, info.project))}${info.branch ? ` ${fg(C.cyan, `⎇ ${info.branch}`)}` : ""}${info.changes ? ` ${fg(C.yel, `✚${info.changes}`)}` : ""}`;
	const left = !session ? where : width >= 100 ? `${session}   ${where}` : session;
	const usage = info.overage ? fg(C.err, bold("⚠ EXTRA USAGE")) : fg(C.dim, `5H ${percent(info.fiveHour, 100)}`);
	const right = `${usage}${fg(C.dim, ` · CTX ${percent(info.contextPercent)} · ${info.model}·${info.thinking}`)}`;
	return fit(left, right, width);
}
