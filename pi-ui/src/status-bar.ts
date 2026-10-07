/** The status bar above the editor: one line, one color per state (Neon Night principle 1). */
import { C, bold, fg, fit, label } from "./palette.ts";
import { elapsedSeconds, type TurnStatus } from "./status.ts";

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 950 → "950", 12400 → "12,4k", 1250000 → "1,3M" (Italian decimal comma). */
export function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	const [value, unit] = count < 1_000_000 ? [count / 1000, "k"] : [count / 1_000_000, "M"];
	return `${value.toFixed(1).replace(".", ",")}${unit}`;
}

const hint = (key: string, text: string) => `${fg(C.text, key)} ${fg(C.dim, text)}`;

export function renderStatusBar(status: TurnStatus, width: number, now: number, frame: number): string {
	const seconds = elapsedSeconds(status, now);
	switch (status.mode) {
		case "working": {
			const step = status.step > 0 ? ` · passo ${status.step}` : "";
			const left = `${label(C.cyan, ` ${SPINNER[frame % SPINNER.length]} AL LAVORO `)}  ${bold(fg(C.text, status.activity))}${fg(C.dim, `${step} · ${seconds}s`)}`;
			return fit(left, hint("esc", "interrompi"), width);
		}
		case "waiting":
			return fit(`${label(C.yel, " ◆ TOCCA A TE ")}  ${fg(C.text, status.question ?? "")}`, fg(C.yel, status.answers ?? ""), width);
		case "stopped":
			return fit(`${label(C.err, " ✗ FERMO ")}  ${fg(C.text, status.activity)}`, hint("↵", "scrivi tu"), width);
		case "done":
			return fit(`${label(C.ok, " ✓ FATTO ")}  ${fg(C.text, `${seconds}s · ↑${formatTokens(status.tokensIn)} ↓${formatTokens(status.tokensOut)} tok`)}`, "", width);
		default:
			return fit(label(C.faint, " PRONTO "), "", width);
	}
}
