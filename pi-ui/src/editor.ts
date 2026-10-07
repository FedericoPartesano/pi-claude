/** The prompt frame: `╱─ PROMPT ───┐` on top and `└───╱` below, magenta at rest and grey while Pi works. */
import { visibleWidth } from "@earendil-works/pi-tui";
import { C, bold, fg } from "./palette.ts";

export function frameEditor(lines: string[], width: number, working: boolean): string[] {
	if (lines.length < 2 || width < 12) return lines;
	const color = working ? C.faint : C.mag;
	const title = `${fg(color, "╱─")} ${bold(fg(color, "PROMPT"))} `;
	const framed = [...lines];
	framed[0] = title + fg(color, "─".repeat(Math.max(0, width - visibleWidth(title) - 1)) + "┐");
	framed[framed.length - 1] = fg(color, `└${"─".repeat(width - 2)}╱`);
	return framed;
}
