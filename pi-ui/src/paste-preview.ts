/** Preview strip above the prompt: the images whose paths are in the text being written (pasted screenshots), side by side. */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Thumbnail } from "./images.ts";
import { C, fg } from "./palette.ts";

export const PREVIEW_ROWS = 8;
export const PREVIEW_MAX = 4;
const PREVIEW_COLS = 24;
const GAP = 2;

/** Columns of a preview: wide enough to see, narrow enough that the height stays within PREVIEW_ROWS (a cell is two pixels tall). */
export function previewColumns(width: number, height: number, count: number, room: number): number {
	const each = Math.max(8, Math.floor((room - 2 - GAP * (count - 1)) / Math.max(1, count)));
	const byHeight = Math.max(4, Math.floor((PREVIEW_ROWS * 2 * width) / Math.max(1, height)));
	return Math.max(4, Math.min(PREVIEW_COLS, each, byHeight));
}

/** Local image paths in the text that can be previewed (URLs are skipped: nothing is downloaded while typing). */
export const localRefs = (refs: string[]) => refs.filter((ref) => !/^https?:\/\//i.test(ref));

/** Lines of the strip: previews side by side (loaded ones only), «+N» when more images than PREVIEW_MAX. */
export function renderPasteStrip(thumbs: (Thumbnail | undefined)[], total: number, width: number): string[] {
	const ready = thumbs.filter((thumb): thumb is Extract<Thumbnail, { lines: string[] }> => Boolean(thumb) && !("error" in (thumb as object)));
	if (!ready.length) return [];
	const rows = Math.min(PREVIEW_ROWS, Math.max(...ready.map((thumb) => thumb.lines.length)));
	const out: string[] = [];
	for (let row = 0; row < rows; row++) {
		let text = "  ";
		for (const thumb of ready) {
			const cell = thumb.lines[row] ?? "";
			const cols = Math.max(...thumb.lines.map((line) => visibleWidth(line)));
			text += `${cell}${" ".repeat(Math.max(0, cols - visibleWidth(cell)))}${" ".repeat(GAP)}`;
		}
		if (row === 0 && total > thumbs.length) text += fg(C.dim, `+${total - thumbs.length}`);
		out.push(truncateToWidth(text, width, ""));
	}
	return out;
}
