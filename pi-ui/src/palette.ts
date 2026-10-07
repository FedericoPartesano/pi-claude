/** Neon Night palette (Claude Design review) and the ANSI helpers pi-ui renders with. */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const C = {
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
} as const;

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
