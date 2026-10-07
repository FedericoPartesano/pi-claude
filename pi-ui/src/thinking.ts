/** The model's thinking as in the design (component 03): folded to one line, opened with a header and a │ gutter. */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { C, bg, fg } from "./palette.ts";

/** Shown by Pi for every folded thinking block (hideThinkingBlock): Ctrl+T opens all, a click opens one (fullscreen). */
export const HIDDEN_THINKING_LABEL = "◇ penso ▸  ctrl+t apre · clic su un blocco apre solo quello";

const HEADER = "◇ **penso** ▾";

/** Open thinking: header, then the text as a quote (Pi draws quotes with a │ border). */
export function thinkingMarkdown(markdown: string): string {
	if (markdown.startsWith(HEADER)) return markdown;
	const quoted = markdown.trim().split("\n").map((line) => (line.trim() ? `> ${line}` : ">")).join("\n");
	return `${HEADER}\n\n${quoted}`;
}


/** Lines of live thinking shown while the model reasons (then the box disappears). */
export const THINKING_BOX_LINES = 3;

/** Dark box with the last lines of the thinking text being streamed, like Claude Code's live thinking. */
export function renderThinkingBox(text: string, width: number, maxLines = THINKING_BOX_LINES): string[] {
	const plain = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
	if (!plain) return [];
	const inner = Math.max(10, width - 4);
	const lines = wrapTextWithAnsi(plain, inner).slice(-maxLines);
	return lines.map((line) => {
		const body = ` ${fg(C.dim, truncateToWidth(line, inner))}`;
		return `${fg(C.mag, "▌")}${bg(C.panel, body + " ".repeat(Math.max(0, width - 1 - visibleWidth(body))))}`;
	});
}
