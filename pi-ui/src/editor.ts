/**
 * The prompt frame: `╱─ PROMPT ───┐` on top and `└───╱` below, magenta at rest and grey while Pi works. The HUD style
 * cuts the corners: `╱── PROMPT ───◣` and `◥───╱`.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { C, bold, fg, hud } from "./palette.ts";

export function frameEditor(lines: string[], width: number, working: boolean): string[] {
	if (lines.length < 2 || width < 12) return lines;
	const color = working ? C.faint : C.mag;
	const title = `${fg(color, "╱─")} ${bold(fg(color, "PROMPT"))} `;
	const framed = [...lines];
	framed[0] = title + fg(color, "─".repeat(Math.max(0, width - visibleWidth(title) - 1)) + (hud ? "◣" : "┐"));
	// The editor's own bottom border is followed by the autocomplete list when it is open: frame that line, not the last one.
	const bottom = bottomBorderIndex(lines);
	framed[bottom] = fg(color, `${hud ? "◥" : "└"}${"─".repeat(width - 2)}╱`);
	return framed;
}

/** Index of the editor's bottom border: the first line after the top one that is only a ─ rule (maybe with a scroll hint). */
export function bottomBorderIndex(lines: string[]): number {
	for (let i = 1; i < lines.length; i++) {
		const plain = lines[i]!.replace(/\x1b\[[0-9;]*m/g, "");
		if (/^─{3,}/.test(plain) && /─$/.test(plain.trimEnd())) return i;
	}
	return lines.length - 1;
}
