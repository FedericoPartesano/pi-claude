/** The status bar above the editor: one line, one color per state (Neon Night principle 1). */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
		case "waiting": {
			// The answer keys must always stay visible: the question gives way.
			const tag = label(C.yel, " ◆ TOCCA A TE ");
			const answers = fg(C.yel, status.answers ?? "");
			const room = Math.max(0, width - visibleWidth(tag) - visibleWidth(answers) - 4);
			return fit(`${tag}  ${fg(C.text, truncateToWidth(status.question ?? "", room))}`, answers, width);
		}
		case "stopped":
			return fit(`${label(C.err, " ✗ FERMO ")}  ${fg(C.text, status.activity)}`, hint("↵", "scrivi tu"), width);
		case "done": {
			const head = `${label(C.ok, " ✓ FATTO ")}  ${fg(C.text, `${seconds}s · ↑${formatTokens(status.tokensIn)} ↓${formatTokens(status.tokensOut)} tok`)}`;
			const keys = status.suggestions ? `${fg(C.ok, `1-${status.suggestions}`)} ${fg(C.dim, "suggerimenti")}` : "";
			// The warning gives way to the suggestion keys.
			const room = width - visibleWidth(head) - visibleWidth(keys) - 4;
			const warning = status.warning && room > 6 ? `  ${fg(C.warn, truncateToWidth(`⚠ ${status.warning}`, room))}` : "";
			return fit(head + warning, keys, width);
		}
		default:
			return fit(label(C.faint, " PRONTO "), "", width);
	}
}
