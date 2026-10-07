/** The image entry in the chat: half-block thumbnail with path, size and how to open it (design 1i). */
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Thumbnail } from "./images.ts";
import { C, bold, fg, fit, pad, underline } from "./palette.ts";

/** Thumbnail width: 32 cells beside the caption on wide terminals, almost the whole width on narrow ones. */
export const thumbnailColumns = (width: number) => (width >= 70 ? 32 : Math.max(8, width - 8));

export function renderImageEntry(ref: string, thumbnail: Thumbnail | undefined, width: number): string[] {
	const head = (right: string, color: string) => fit(`  ${fg(C.cyan, "◆")} ${bold(fg(C.cyan, "Img"))}   ${fg(C.text, ref)}`, `${fg(color, right)} `, width);
	if (!thumbnail) return [head("…", C.cyan)];
	if ("error" in thumbnail) return [head(thumbnail.error, C.warn)];
	const bar = fg(C.faint, "│");
	const link = fg(C.cyan, underline(ref));
	// Every line is padded to the full width with plain spaces: Pi pads short lines under an overlay (the session
	// panel) and drops their final reset, so the thumbnail colors would bleed up to the panel.
	const full = (line: string) => pad(truncateToWidth(line, width), width);
	if (width < 70) return [...thumbnail.lines.map((line) => full(`  ${bar} ${line}`)), full(`  ${link} ${fg(C.dim, `· ${thumbnail.info} · /img apri`)}`)];
	const caption = [link, fg(C.dim, thumbnail.info), "", `${fg(C.dim, "[")}${fg(C.mag, "/img")} ${fg(C.dim, "apri]")}`];
	return thumbnail.lines.map((line, index) => full(`  ${bar} ${line}  ${caption[index] ?? ""}`));
}
