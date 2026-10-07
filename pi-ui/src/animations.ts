/** Small neon animations for the status bar: a moving wave while thinking, a light running over the current action. */
import { C, bold, fg } from "./palette.ts";

const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const mix = (from: string, to: string, amount: number) =>
	`#${channels(from).map((value, index) => Math.round(value + (channels(to)[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;

/** `cells` blocks with a two-block highlight sliding left to right (magenta head, cyan tail). */
export function wave(frame: number, cells = 6): string {
	const head = (frame % (cells + 2)) - 1;
	let out = "";
	for (let cell = 0; cell < cells; cell++) {
		const distance = head - cell;
		out += distance === 0 ? fg(C.mag, "▰") : distance === 1 ? fg(C.cyan, "▰") : fg(C.faint, "▱");
	}
	return out;
}

/** The text in `base` color with a brighter window running over it, one character per frame. */
export function shimmer(text: string, frame: number, base: string = C.cyan, glow = "#ffffff"): string {
	const characters = [...text];
	const center = (frame % (characters.length + 8)) - 4;
	return bold(characters.map((character, index) => {
		const distance = Math.abs(index - center);
		return fg(distance >= 3 ? base : mix(glow, base, distance / 3), character);
	}).join(""));
}

/** The latest thought of a thinking text: last sentence (complete or not), without markdown, at most 90 characters. */
export function lastSentence(text: string): string {
	const plain = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
	if (!plain) return "";
	const sentences = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
	const last = sentences[sentences.length - 1] ?? "";
	return last.length > 90 ? `…${last.slice(-89)}` : last;
}
