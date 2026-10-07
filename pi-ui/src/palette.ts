/** pi-ui palettes (Neon Night from the Claude Design review, lilla from the user's WezTerm) and ANSI helpers. */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const NEON_NIGHT = {
	bg: "#0c0c0c",
	panel: "#13121a",
	userBg: "#1c1326",
	text: "#dcdfe8",
	dim: "#858ba0",
	faint: "#4c5163",
	border: "#2e3140",
	mag: "#ff3fd8",
	cyan: "#2ee6ff",
	yel: "#f5e14a",
	ok: "#3df2a0",
	warn: "#f5b942",
	err: "#ff4d6d",
	add: "#7cf5bd",
	addBg: "#0e2a20",
	del: "#ff8fa8",
	delBg: "#2f1220",
};

export type Palette = typeof NEON_NIGHT;

/** The pastels of the user's WezTerm theme (background #1C2023): panels are lighter than the background, not darker. */
const LILLA: Palette = {
	bg: "#1C2023",
	panel: "#262b30",
	userBg: "#2b2635",
	text: "#C7CCD1",
	dim: "#8a929a",
	faint: "#555d65",
	border: "#383f45",
	mag: "#AE95C7",
	cyan: "#95AEC7",
	yel: "#C7AE95",
	ok: "#95C7AE",
	warn: "#d9b98f",
	err: "#d98fa8",
	add: "#95C7AE",
	addBg: "#1f2e29",
	del: "#d98fa8",
	delBg: "#33242c",
};

export const PALETTES: Record<string, Palette> = { "neon-night": NEON_NIGHT, lilla: LILLA };

/** Current colors. Renderers read them at render time, so switching the palette recolors everything. */
export const C: Palette = { ...NEON_NIGHT };
let current = "neon-night";

/** Uses the palette of Pi's theme (neon-night or lilla; neon for any other theme). Returns whether it changed. */
export function usePalette(themeName: string | undefined): boolean {
	const name = themeName && PALETTES[themeName] ? themeName : "neon-night";
	if (name === current) return false;
	current = name;
	Object.assign(C, PALETTES[name]);
	return true;
}

const rgb = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(";");
export const fg = (color: string, text: string) => `\x1b[38;2;${rgb(color)}m${text}\x1b[39m`;
export const bg = (color: string, text: string) => `\x1b[48;2;${rgb(color)}m${text}\x1b[49m`;
export const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
export const underline = (text: string) => `\x1b[4m${text}\x1b[24m`;
/** Colored tag with dark text, e.g. ` AL LAVORO `. */
export const label = (color: string, text: string) => bg(color, fg(C.bg, bold(text)));
export const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

/** Left and right parts on one line of exactly `width` columns; the right part goes first when there is no room. */
export function fit(left: string, right: string, width: number): string {
	const gap = width - visibleWidth(left) - visibleWidth(right);
	if (right && gap >= 1) return left + " ".repeat(gap) + right;
	return pad(truncateToWidth(left, width), width);
}
