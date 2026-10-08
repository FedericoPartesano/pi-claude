/**
 * pi-ui palettes (Neon Night from the Claude Design review, lilla from the user's WezTerm, Night City cyberpunk) and
 * ANSI helpers. Night City also turns on the HUD style: block tags, cut corners, numbered sections.
 */
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

/** Cyberpunk: acid yellow as the accent, cyan for actions, red for errors, magenta as the second highlight. */
const NIGHT_CITY: Palette = {
	bg: "#0a0b10",
	panel: "#11131c",
	userBg: "#1b1a0c",
	text: "#d7dae0",
	dim: "#7a8190",
	faint: "#3a3f4b",
	border: "#262a36",
	mag: "#FCEE0A",
	cyan: "#00F0FF",
	yel: "#ff2bd6",
	ok: "#00FF9C",
	warn: "#ff9e00",
	err: "#FF003C",
	add: "#00FF9C",
	addBg: "#0f2a1e",
	del: "#ff4d6d",
	delBg: "#2a0f17",
};

export const PALETTES: Record<string, Palette> = { "neon-night": NEON_NIGHT, lilla: LILLA, "night-city": NIGHT_CITY };

/** HUD style (Night City): renderers read it at render time, like the colors. */
export let hud = false;

/** Current colors. Renderers read them at render time, so switching the palette recolors everything. */
export const C: Palette = { ...NEON_NIGHT };
let current = "neon-night";

/** Uses the palette of Pi's theme (neon-night, lilla or night-city; neon for any other theme). Returns whether it changed. */
export function usePalette(themeName: string | undefined): boolean {
	const name = themeName && PALETTES[themeName] ? themeName : "neon-night";
	if (name === current) return false;
	current = name;
	hud = name === "night-city";
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
/** A tag; in the HUD style framed as a block: `▐█ AL LAVORO █▌`. */
export const tag = (color: string, text: string) => (hud ? `${fg(color, "▐")}${label(color, text)}${fg(color, "▌")}` : label(color, text));
export const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

/** Left and right parts on one line of exactly `width` columns; the right part goes first when there is no room. */
export function fit(left: string, right: string, width: number): string {
	const gap = width - visibleWidth(left) - visibleWidth(right);
	if (right && gap >= 1) return left + " ".repeat(gap) + right;
	return pad(truncateToWidth(left, width), width);
}
