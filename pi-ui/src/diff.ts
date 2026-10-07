/** Compact diff rows for edits, from the unified patch Pi's edit tool returns (details.patch). */
import { C, bg, fg, pad } from "./palette.ts";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface DiffLine {
	kind: "add" | "del";
	line: number;
	text: string;
}

export function parsePatch(patch: string): DiffLine[] {
	const lines: DiffLine[] = [];
	let oldLine = 0;
	let newLine = 0;
	for (const raw of patch.split("\n")) {
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
		} else if (raw.startsWith("---") || raw.startsWith("+++")) {
			continue;
		} else if (raw.startsWith("-")) {
			lines.push({ kind: "del", line: oldLine++, text: raw.slice(1) });
		} else if (raw.startsWith("+")) {
			lines.push({ kind: "add", line: newLine++, text: raw.slice(1) });
		} else if (raw.startsWith(" ")) {
			oldLine++;
			newLine++;
		}
	}
	return lines;
}

export function diffCounts(patch: string): { added: number; removed: number } {
	const lines = parsePatch(patch);
	return { added: lines.filter((line) => line.kind === "add").length, removed: lines.filter((line) => line.kind === "del").length };
}

/** Rows with line number, sign and green/red background, full width; at most `max`, then "… altre N righe". */
export function renderDiff(lines: DiffLine[], width: number, max = 6, indent = 4): string[] {
	const rows = lines.slice(0, max).map(({ kind, line, text }) => {
		const color = kind === "add" ? C.add : C.del;
		const body = `${String(line).padStart(4)} ${kind === "add" ? "+" : "-"} ${text.replace(/\t/g, "  ")}`;
		return " ".repeat(indent) + bg(kind === "add" ? C.addBg : C.delBg, fg(color, pad(truncateToWidth(body, width - indent), width - indent)));
	});
	if (lines.length > max) rows.push(pad(" ".repeat(indent) + fg(C.dim, `… altre ${lines.length - max} righe`), width));
	return rows;
}
