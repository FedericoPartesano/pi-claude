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
	framed[framed.length - 1] = fg(color, `${hud ? "◥" : "└"}${"─".repeat(width - 2)}╱`);
	return framed;
}
