/** The model's thinking as in the design (component 03): folded to one line, opened with a header and a │ gutter. */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { C, bg, bold, fg } from "./palette.ts";

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const plainOf = (text: string) => text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();

/** Generic folded label (no thinking text known yet). */
export const HIDDEN_THINKING_LABEL = "◇ thinking ▸  ctrl+t opens all · click a block to open just that one";

/** First sentence of the thinking, cut short: what the model was about to do. */
export function thinkingGist(text: string, max = 60): string {
	const plain = plainOf(text);
	const sentence = plain.split(/(?<=[.!?:])\s/)[0] ?? plain;
	return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** Folded line for one thinking block: size and gist, then how to open it. */
export function closedLabel(text: string): string {
	const plain = plainOf(text);
	if (!plain) return HIDDEN_THINKING_LABEL;
	return `◇ thinking ▸ ${words(plain)} words · ${thinkingGist(plain)}  ctrl+t opens`;
}

const HEADER = "◇ **thinking** ▾";

/** Open thinking shows only its last lines until /thinking opens it whole (a long thought would scroll the chat away). */
export const CLAMP_LINES = 5;
let expanded = false;
export const thinkingExpanded = () => expanded;
export const setThinkingExpanded = (value: boolean) => {
	expanded = value;
};

/** Open thinking: header, then the text as a quote (Pi draws quotes with a │ border). The clamp happens after Pi lays it out. */
export function thinkingMarkdown(markdown: string): string {
	if (markdown.startsWith(HEADER)) return markdown;
	const head = `${HEADER} · ${words(markdown)} words`;
	// Paragraph breaks only; single newlines inside a paragraph join, so the text reads as prose in the gutter.
	const paragraphs = markdown.trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
	return `${head}\n\n${paragraphs.map((line) => `> ${line}`).join("\n>\n")}`;
}

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/**
 * Open thinking as Pi rendered it (header line, then the quote): keeps the header and the last CLAMP_LINES text lines,
 * counted on the real layout (width, sidebar and padding included), unless it is expanded or already short.
 */
export function clampThinkingLines(lines: string[], full = expanded): string[] {
	const at = lines.findIndex((line) => plain(line).includes("◇ thinking ▾"));
	if (at < 0 || full) return lines;
	const body = lines.slice(at + 1).filter((line) => plain(line).replace(/[│▌┃|>\s]/g, "") !== "");
	if (body.length <= CLAMP_LINES) return lines;
	const note = `\x1b[2m · last ${CLAMP_LINES} lines (+${body.length - CLAMP_LINES} above, /thinking opens all)\x1b[22m`;
	// Pi pads the header to the full width: drop the padding so the note stays inside the line.
	const header = lines[at].replace(/ +((?:\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)))*)$/, "$1");
	return [...lines.slice(0, at), `${header}${note}`, "", ...body.slice(-CLAMP_LINES)];
}

/** Lines of live thinking shown while the model reasons (then the box disappears). */
export const THINKING_BOX_LINES = 5;

export interface BoxOptions {
	/** Seconds since the thinking started. */
	seconds?: number;
	/** Animation frame: the left bar pulses. */
	frame?: number;
	maxLines?: number;
}

/** Dark box: a header (time, words) and the last lines of the streamed thinking, older lines fainter. */
export function renderThinkingBox(text: string, width: number, options: BoxOptions = {}): string[] {
	const plain = plainOf(text);
	if (!plain) return [];
	const { seconds, frame = 0, maxLines = THINKING_BOX_LINES } = options;
	const inner = Math.max(10, width - 4);
	const bar = fg((frame >> 2) % 2 ? C.mag : C.cyan, "▌");
	const row = (body: string) => `${bar}${bg(C.panel, body + " ".repeat(Math.max(0, width - 1 - visibleWidth(body))))}`;
	const head = ` ${fg(C.mag, "◇")} ${bold(fg(C.mag, "thinking"))}${fg(C.dim, ` · ${seconds === undefined ? "" : `${seconds}s · `}${words(plain)} words`)}`;
	const lines = wrapTextWithAnsi(plain, inner).slice(-maxLines);
	return [
		row(head),
		...lines.map((line, index) => row(` ${fg(index < lines.length - 2 && lines.length > 2 ? C.faint : C.dim, truncateToWidth(line, inner))}`)),
	];
}

let shown = false;
/** True while Pi itself shows the thinking text open (ctrl+t): the live box would repeat it, so it stays away. */
export const thinkingShown = () => shown;

type Patchable = { updateContent?: (message: unknown) => void; hiddenThinkingLabel?: string; hideThinkingBlock?: boolean };

/** Pi has one folded label for all blocks: set it per message from its own thinking, just before each render. */
export function patchClosedLabel(proto: Patchable): boolean {
	if (!proto || typeof proto.updateContent !== "function" || Object.prototype.hasOwnProperty.call(proto, "piUiClosedLabel")) return false;
	const original = proto.updateContent;
	proto.updateContent = function (this: Patchable, message: unknown) {
		shown = this.hideThinkingBlock === false;
		const content = (message as { content?: { type: string; thinking?: string }[] } | undefined)?.content;
		if (this.hiddenThinkingLabel?.startsWith("◇ thinking") && Array.isArray(content)) {
			const text = content.filter((part) => part.type === "thinking").map((part) => part.thinking ?? "").join("\n\n");
			this.hiddenThinkingLabel = closedLabel(text);
		}
		const result = original.call(this, message);
		// Clamp the open thinking blocks after Pi lays them out: only then is the real width known.
		for (const child of (this as { contentContainer?: { children?: { render?: (width: number) => string[] }[] } }).contentContainer?.children ?? []) {
			const render = child.render;
			if (typeof render !== "function") continue;
			child.render = (width: number) => clampThinkingLines(render.call(child, width));
		}
		return result;
	};
	Object.defineProperty(proto, "piUiClosedLabel", { value: true });
	return true;
}
