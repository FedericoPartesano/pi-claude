/** One-line footer: session state (goal/loop/team), project and git, usage. Replaces Pi's footer. */
import { I } from "./icons.ts";
import { C, bold, fg, fit, hud, tag } from "./palette.ts";

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
	/** Modalità senza permessi (`pi -d`): etichetta sempre visibile. */
	yolo?: boolean;
}

const session = () =>
	[
		["goal", "GOAL", C.mag],
		["loop", "LOOP", C.cyan],
		["team", "TEAM", C.yel],
	] as const;

const percent = (value: number | undefined, scale = 1) => (value === undefined ? "–" : `${Math.round(value * scale)}%`);

export function renderFooter(info: FooterInfo, width: number): string {
	const sessionText = session().flatMap(([key, name, color]) => {
		const text = info.statuses.get(key)?.replace(new RegExp(`^${key}\\s*`, "i"), "");
		// HUD: GOAL/LOOP/TEAM as colored blocks.
		return text ? [hud ? `${tag(color, ` ${name} `)} ${fg(C.text, text)}` : `${bold(fg(color, name))} ${fg(C.text, text)}`] : [];
	}).join("  ");
	// Badge di Caveman (livello scelto da PI_CAVEMAN): sempre visibile, anche da spento.
	const level = info.statuses.get("caveman");
	const badge = level ? (level === "off" ? fg(C.dim, "CAVEMAN OFF") : hud ? tag(C.cyan, ` CAVEMAN ${level.toUpperCase()} `) : bold(fg(C.cyan, `CAVEMAN ${level.toUpperCase()}`))) : "";
	const where = `${bold(fg(C.text, info.project))}${info.branch ? ` ${fg(C.cyan, `${I.branch || "⎇"} ${info.branch}`)}` : ""}${info.changes ? ` ${fg(C.yel, `✚${info.changes}`)}` : ""}`;
	// Memory status from the memory extension: only its first part ("◇ 3 ricordi richiamati"); the panel has the rest.
	const memory = info.statuses.get("memory")?.split(" · ")[0];
	const place = memory && width >= 100 ? `${where}  ${fg(C.dim, memory)}` : where;
	const base0 = !sessionText ? place : width >= 100 ? `${sessionText}   ${place}` : sessionText;
	const base = badge ? `${badge}  ${base0}` : base0;
	const left = info.yolo ? `${hud ? tag(C.err, " SENZA PERMESSI ") : bold(fg(C.err, "SENZA PERMESSI"))}  ${base}` : base;
	const usage = info.overage ? fg(C.err, bold("⚠ EXTRA USAGE")) : fg(C.dim, `5H ${percent(info.fiveHour, 100)}`);
	const right = `${usage}${fg(C.dim, ` · CTX ${percent(info.contextPercent)} · ${info.model}·${info.thinking}`)}`;
	return fit(left, right, width);
}
