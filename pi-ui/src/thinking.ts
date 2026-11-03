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

const BLOCKS = "▁▂▃▄▅▆▇█";

/** Shape of the thought: words per sentence, as up to `cells` bars (long sentences are tall). */
export function sparkline(text: string, cells = 8): string {
	const lengths = plainOf(text).split(/(?<=[.!?:])\s+/).map(words).filter(Boolean);
	if (lengths.length < 3) return "";
	const size = Math.ceil(lengths.length / cells);
	const groups: number[] = [];
	for (let i = 0; i < lengths.length; i += size) groups.push(Math.max(...lengths.slice(i, i + size)));
	const top = Math.max(...groups);
	return groups.map((value) => BLOCKS[Math.min(7, Math.floor((value / top) * 7.99))]).join("");
}

/** Folded line for one thinking block: size, shape and gist, then how to open it. */
export function closedLabel(text: string): string {
	const plain = plainOf(text);
	if (!plain) return HIDDEN_THINKING_LABEL;
	const shape = sparkline(plain);
	return `◇ thinking ▸ ${words(plain)} words${shape ? ` ${shape}` : ""} · ${thinkingGist(plain)}  ctrl+t opens`;
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
	/** Token flow (see ThinkingRate.sample): drives the wave. */
	flow?: { level: number; phase: number };
	maxLines?: number;
}

const mix = (from: string, to: string, t: number) => {
	const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	return `#${[0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t).toString(16).padStart(2, "0")).join("")}`;
};

/**
 * How fast the thinking text is arriving: characters per second, smoothed (half-life ~1.2 s), as a 0..1 level, plus a
 * wave phase that advances faster when the flow is faster (so the wave never jumps when the speed changes).
 */
export class ThinkingRate {
	private rate = 0;
	private chars = 0;
	private at = 0;
	private phase = 0;
	/** Called with the whole thinking text each time it grows. */
	push(text: string, now: number): void {
		if (text.length < this.chars) this.chars = 0;
		this.advance(now, text.length - this.chars);
		this.chars = text.length;
	}
	/** Called with the size of a new piece of text (thinking or answer) when only the delta is known. */
	add(chars: number, now: number): void {
		this.advance(now, chars);
	}
	private advance(now: number, added: number): void {
		const dt = this.at ? Math.max(0, (now - this.at) / 1000) : 0;
		this.at = now;
		if (dt > 0) {
			const keep = 0.5 ** (dt / 1.2);
			this.rate = this.rate * keep + (added / dt) * (1 - keep);
			this.phase += dt * (0.6 + 4 * this.level());
		} else this.rate += added;
	}
	/** 0 (nothing arriving) to 1 (about 150 characters a second or more). */
	level(): number {
		return Math.min(1, this.rate / 150);
	}
	/** Moves the clock to `now` (no new text) and returns what the wave needs. */
	sample(now: number): { level: number; phase: number } {
		this.advance(now, 0);
		return { level: this.level(), phase: this.phase };
	}
	reset(): void {
		this.rate = 0;
		this.chars = 0;
		this.at = 0;
		this.phase = 0;
	}
}

/**
 * A wave of bars, `cells` wide. With a `flow` (level 0..1 and phase) the height follows how fast the text arrives:
 * flat when idle, tall and quick when it pours. Without one, a calm fixed wave (about 4 steps a second at 7 fps).
 */
export function neuralWave(cells: number, frame: number, flow?: { level: number; phase: number }, scale = 1): string {
	const step = flow ? flow.phase : frame >> 1;
	const amplitude = flow ? 0.12 + 0.88 * flow.level : 1;
	return Array.from({ length: cells }, (_, i) => {
		const level = (Math.sin(i * scale * 0.55 + step * 0.7) * 0.5 + Math.sin(i * scale * 0.23 - step * 0.45) * 0.5) * amplitude;
		return BLOCKS[Math.max(0, Math.min(7, Math.round(((level + 1) / 2) * 7)))];
	}).join("");
}

/** Dark box: a header with a calm wave, and the last lines of the streamed thinking: older fainter, a cursor at the end. */
export function renderThinkingBox(text: string, width: number, options: BoxOptions = {}): string[] {
	const plain = plainOf(text);
	if (!plain) return [];
	const { seconds, frame = 0, flow, maxLines = THINKING_BOX_LINES } = options;
	const inner = Math.max(10, width - 4);
	// The bar breathes between cyan and magenta over about 5 seconds.
	const phase = (Math.sin((frame / 7) * 1.25) + 1) / 2;
	const bar = fg(mix(C.cyan, C.mag, phase), "▌");
	const row = (body: string) => `${bar}${bg(C.panel, body + " ".repeat(Math.max(0, width - 1 - visibleWidth(body))))}`;
	const title = ` ${fg(C.mag, "◇")} ${bold(fg(C.mag, "thinking"))}${fg(C.dim, ` · ${seconds === undefined ? "" : `${seconds}s · `}${words(plain)} words `)}`;
	const room = width - 1 - visibleWidth(title) - 1;
	const head = room >= 8 ? `${title}${fg(mix(C.faint, C.cyan, 0.6), neuralWave(Math.min(24, room), frame, flow))}` : title;
	const lines = wrapTextWithAnsi(plain, inner).slice(-maxLines);
	const cursor = (frame >> 2) % 2 ? " " : fg(C.cyan, "▍");
	return [
		row(head),
		...lines.map((line, index) => {
			const age = lines.length - 1 - index;
			const color = age === 0 ? C.text : age === 1 ? C.dim : C.faint;
			const body = truncateToWidth(line, inner - 1);
			return row(` ${fg(color, body)}${age === 0 ? cursor : ""}`);
		}),
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
