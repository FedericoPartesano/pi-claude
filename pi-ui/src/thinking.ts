/** The model's thinking as in the design (component 03): folded to one line, opened with a header and a │ gutter. */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { C, bg, bold, fg } from "./palette.ts";

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const plainOf = (text: string) => text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();

/** Generic folded label (no thinking text known yet). */
export const HIDDEN_THINKING_LABEL = "◇ penso ▸  ctrl+t apre · clic su un blocco apre solo quello";

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
	return `◇ penso ▸ ${words(plain)} parole · ${thinkingGist(plain)}  ctrl+t apre`;
}

const HEADER = "◇ **penso** ▾";

/** Open thinking: header, then the text as a quote (Pi draws quotes with a │ border). */
export function thinkingMarkdown(markdown: string): string {
	if (markdown.startsWith(HEADER)) return markdown;
	// Paragraph breaks only; single newlines inside a paragraph join, so the text reads as prose in the gutter.
	const paragraphs = markdown.trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
	const quoted = paragraphs.map((line) => `> ${line}`).join("\n>\n");
	return `${HEADER} · ${words(markdown)} parole\n\n${quoted}`;
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
	const head = ` ${fg(C.mag, "◇")} ${bold(fg(C.mag, "penso"))}${fg(C.dim, ` · ${seconds === undefined ? "" : `${seconds}s · `}${words(plain)} parole`)}`;
	const lines = wrapTextWithAnsi(plain, inner).slice(-maxLines);
	return [
		row(head),
		...lines.map((line, index) => row(` ${fg(index < lines.length - 2 && lines.length > 2 ? C.faint : C.dim, truncateToWidth(line, inner))}`)),
	];
}

type Patchable = { updateContent?: (message: unknown) => void; hiddenThinkingLabel?: string };

/** Pi has one folded label for all blocks: set it per message from its own thinking, just before each render. */
export function patchClosedLabel(proto: Patchable): boolean {
	if (!proto || typeof proto.updateContent !== "function" || Object.prototype.hasOwnProperty.call(proto, "piUiClosedLabel")) return false;
	const original = proto.updateContent;
	proto.updateContent = function (this: Patchable, message: unknown) {
		const content = (message as { content?: { type: string; thinking?: string }[] } | undefined)?.content;
		if (this.hiddenThinkingLabel?.startsWith("◇ penso") && Array.isArray(content)) {
			const text = content.filter((part) => part.type === "thinking").map((part) => part.thinking ?? "").join("\n\n");
			this.hiddenThinkingLabel = closedLabel(text);
		}
		return original.call(this, message);
	};
	Object.defineProperty(proto, "piUiClosedLabel", { value: true });
	return true;
}
