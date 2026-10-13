/** One-line footer: session state (goal/loop/team), project and git, usage. Replaces Pi's footer. */
import { visibleWidth } from "@earendil-works/pi-tui";
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
	/** Versions of Pi and of this package, always shown at the far right ("pi 1.2.0 · pi-claude 0.2.0 (03c1b55)"). */
	versions?: { pi: string; own: string; commit?: string };
	/** Modalità senza permessi (`pi -d`): etichetta sempre visibile. */
	yolo?: boolean;
}

const session = () =>
	[
		["goal", "GOAL", C.mag],
		["intent", "INTENT", C.ok],
		["loop", "LOOP", C.cyan],
		["team", "TEAM", C.yel],
	] as const;

/** Model family from its id ("opus", "claude-sonnet-4-5" → OPUS, SONNET), with its own color: always a colored block. */
export function modelBadge(model: string): string {
	const family = /opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase();
	const color = family === "opus" ? C.mag : family === "sonnet" ? C.ok : family === "haiku" ? C.yel : C.cyan;
	return tag(color, ` MODELLO ${(family ?? model).toUpperCase()} `);
}

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
	const sending = info.statuses.get("bug-upload");
	const base1 = badge ? `${badge}  ${base0}` : base0;
	const base = sending ? `${bold(fg(C.cyan, sending))}  ${base1}` : base1;
	const withYolo = info.yolo ? `${hud ? tag(C.err, " SENZA PERMESSI ") : bold(fg(C.err, "SENZA PERMESSI"))}  ${base}` : base;
	// The model first: the most visible thing in the footer (it decides quota and reasoning).
	const left = `${modelBadge(info.model)}  ${withYolo}`;
	const usage = info.overage ? fg(C.err, bold("⚠ EXTRA USAGE")) : fg(C.dim, `5H ${percent(info.fiveHour, 100)}`);
	const v = info.versions;
	const versions = !v ? "" : width >= 120 ? ` · pi ${v.pi} · pi-claude ${v.own}${v.commit ? ` (${v.commit})` : ""}` : width >= 90 ? ` · pi ${v.pi} · pi-claude ${v.own}` : "";
	// Narrow terminal: the usage stays, the reasoning level and the versions go first.
	const rights = [`${usage}${fg(C.dim, ` · CTX ${percent(info.contextPercent)} · ragionamento ${info.thinking}${versions}`)}`, `${usage}${fg(C.dim, ` · CTX ${percent(info.contextPercent)}`)}`];
	const right = rights.find((candidate) => visibleWidth(left) + visibleWidth(candidate) + 1 <= width) ?? rights[0];
	return fit(left, right, width);
}
