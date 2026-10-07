/**
 * The pi-full intro: a big PI//CLAUDE logo that decodes out of glitch characters, then glows with the theme's gradient and
 * a light running across it, while a subtitle types itself and a bar fills. Pure frames: bin/intro.ts plays them.
 */

/** ANSI Shadow letters (6 rows); every row of a letter has the same width. */
const FONT: Record<string, string[]> = {
	P: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔═══╝ ", "██║     ", "╚═╝     "],
	I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
	"/": ["    ██╗", "   ██╔╝", "  ██╔╝ ", " ██╔╝  ", "██╔╝   ", "╚═╝    "],
	C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
	L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
	A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
	U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
	D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
	E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
};

export const INTRO_MS = 2000;
const GLITCH = "ｱｲｳｴｵｶｷｸ01<>/\\#%&*+=?░▒▓";

/** The logo for a terminal width: the big one from 80 columns, a spaced one-liner below. */
export function logoFor(width: number): string[] {
	if (width < 80) return ["P I / / C L A U D E"];
	const rows = ["", "", "", "", "", ""];
	for (const letter of "PI//CLAUDE") FONT[letter].forEach((part, row) => (rows[row] += part));
	return rows;
}

const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const mix = (from: number[], to: number[], amount: number) => from.map((value, index) => Math.round(value + (to[index] - value) * Math.max(0, Math.min(1, amount))));
const paint = (color: number[], text: string, bold = false) => `${bold ? "\x1b[1m" : ""}\x1b[38;2;${color.join(";")}m${text}\x1b[0m`;
const WHITE = [255, 255, 255];
const BLACK = [12, 12, 12];

/** A row of the starfield: sparse dots drifting left and twinkling, in the theme's colors. */
function starRow(row: number, at: number, width: number, from: number[], to: number[], seed: number): string {
	let out = "";
	let blank = 0;
	for (let column = 0; column < width; column++) {
		const speed = 1 + Math.floor(noise(row, 0, 1, seed) * 3);
		const source = column + Math.floor((at / 1000) * speed * 6);
		const star = noise(row, source, 2, seed);
		if (star > 0.985) {
			const twinkle = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(at / 120 + source));
			out += " ".repeat(blank) + paint(mix(BLACK, mix(from, to, column / width), twinkle), star > 0.997 ? "✦" : star > 0.992 ? "+" : "·");
			blank = 0;
		} else blank++;
	}
	return out;
}

/** Deterministic noise in [0, 1) so tests and frames are reproducible. */
function noise(a: number, b: number, c: number, seed: number): number {
	const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + seed * 4.1414) * 43758.5453;
	return value - Math.floor(value);
}

export interface IntroOptions {
	width: number;
	height: number;
	subtitle: string;
	/** Gradient of the theme: [from, to] as #rrggbb. */
	palette: [string, string];
	seed: number;
}

/** One frame at `at` milliseconds: exactly `height` lines, none wider than `width`. */
export function introFrame(at: number, options: IntroOptions): string[] {
	const { width, height, subtitle, seed } = options;
	const from = channels(options.palette[0]);
	const to = channels(options.palette[1]);
	const logo = logoFor(width);
	const logoWidth = [...logo[0]].length;
	const top = Math.max(0, Math.floor((height - logo.length - 4) / 2));
	const leftColumn = Math.max(0, Math.floor((width - logoWidth) / 2));
	const left = " ".repeat(leftColumn);
	const lines: string[] = Array.from({ length: height }, (_, row) => starRow(row, at, width, from, to, seed));
	// The flash when the decode lands, fading out.
	const flash = Math.max(0, 1 - Math.abs(at - 720) / 160);

	// The light runs across the logo once the decode is done.
	const shine = ((at - 750) / 800) * (logoWidth + 24) - 12;
	logo.forEach((row, rowIndex) => {
		let out = "";
		[...row].forEach((char, column) => {
			if (char === " ") return void (out += " ");
			const resolveAt = 80 + (column / logoWidth) * 520 + noise(rowIndex, column, 0, seed) * 160;
			if (at < resolveAt) {
				// Not resolved yet: nothing far from the wave, glitch characters close to it.
				if (at < resolveAt - 320) return void (out += " ");
				const glyph = GLITCH[Math.floor(noise(rowIndex, column, Math.floor(at / 45), seed) * GLITCH.length)];
				return void (out += paint(mix(BLACK, mix(from, to, column / logoWidth), 0.55), glyph));
			}
			const base = mix(from, to, column / logoWidth + rowIndex * 0.02);
			const lit = Math.max(0, 1 - Math.abs(column - shine) / 4);
			const shadow = !"█".includes(char);
			out += paint(shadow ? mix(base, BLACK, 0.45) : mix(base, WHITE, Math.max(lit * 0.8, flash * 0.9)), char, !shadow);
		});
		lines[top + rowIndex] = left + out;
	});

	// HUD brackets that close in on the logo.
	const close = Math.max(0, Math.min(1, (at - 450) / 400));
	if (close > 0 && logo.length > 1 && top > 0 && leftColumn >= 4) {
		const spread = Math.round((1 - close) * 6);
		const l = Math.max(0, leftColumn - 3 - spread);
		const r = Math.min(width - 2, leftColumn + logoWidth + 2 + spread);
		const color = mix(BLACK, from, 0.4 + close * 0.6);
		const colorRight = mix(BLACK, to, 0.4 + close * 0.6);
		const bracket = (row: number, a: string, b: string) => {
			if (row < 0 || row >= height) return;
			lines[row] = " ".repeat(l) + paint(color, a) + " ".repeat(Math.max(1, r - l - 2)) + paint(colorRight, b);
		};
		bracket(top - 1, "╭─", "─╮");
		bracket(top + logo.length, "╰─", "─╯");
	}

	// Subtitle typing itself, then a loading bar with the same gradient.
	const typed = [...subtitle].slice(0, Math.max(0, Math.floor((at - 700) / 14))).join("");
	const subtitleLine = `${paint(from, "◆", true)} ${paint(mix(from, WHITE, 0.55), typed)}${typed.length < [...subtitle].length && at > 700 ? paint(to, "▏") : ""}`;
	const subtitlePad = " ".repeat(Math.max(0, Math.floor((width - subtitle.length - 2) / 2)));
	if (top + logo.length + 1 < height) lines[top + logo.length + 1] = subtitlePad + subtitleLine;
	const cells = Math.min(32, Math.max(8, width - 8));
	const filled = Math.round(Math.max(0, Math.min(1, (at - 500) / (INTRO_MS - 700))) * cells);
	const bar = Array.from({ length: cells }, (_, index) => (index < filled ? paint(mix(from, to, index / cells), "▰") : paint(mix(BLACK, WHITE, 0.25), "▱"))).join("");
	if (top + logo.length + 3 < height) lines[top + logo.length + 3] = " ".repeat(Math.max(0, Math.floor((width - cells) / 2))) + bar;
	return lines;
}
