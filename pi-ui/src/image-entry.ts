/** The image entry in the chat: half-block thumbnail with path, size and how to open it (design 1i). */
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Thumbnail } from "./images.ts";
import { C, bold, fg, fit, underline } from "./palette.ts";

/** Thumbnail width: 32 cells beside the caption on wide terminals, almost the whole width on narrow ones. */
export const thumbnailColumns = (width: number) => (width >= 70 ? 32 : Math.max(8, width - 8));

export function renderImageEntry(ref: string, thumbnail: Thumbnail | undefined, width: number): string[] {
	const head = (right: string, color: string) => fit(`  ${fg(C.cyan, "◆")} ${bold(fg(C.cyan, "Img"))}   ${fg(C.text, ref)}`, `${fg(color, right)} `, width);
	if (!thumbnail) return [head("…", C.cyan)];
	if ("error" in thumbnail) return [head(thumbnail.error, C.warn)];
	const bar = fg(C.faint, "│");
	const link = fg(C.cyan, underline(ref));
	if (width < 70) return [...thumbnail.lines.map((line) => `  ${bar} ${line}`), truncateToWidth(`  ${link} ${fg(C.dim, `· ${thumbnail.info} · /img apri`)}`, width)];
	const caption = [link, fg(C.dim, thumbnail.info), "", `${fg(C.dim, "[")}${fg(C.mag, "/img")} ${fg(C.dim, "apri]")}`];
	return thumbnail.lines.map((line, index) => truncateToWidth(`  ${bar} ${line}  ${caption[index] ?? ""}`.trimEnd(), width));
}
