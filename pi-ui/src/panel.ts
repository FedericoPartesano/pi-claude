/**
 * The session panel (Alt+I, Neon Night principle 5): goal/loop/team, changed files, failing tests, the last image and
 * usage. Drawn as an overlay on the right that never takes the keyboard.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "./status-bar.ts";
import { C, bg, bold, fg, fit, pad, underline } from "./palette.ts";

export interface ChangedFile {
	status: string;
	path: string;
	added?: number;
	removed?: number;
}

export interface PanelInfo {
	/** setStatus texts of goal, loop and team. */
	session: ReadonlyMap<string, string>;
	files: ChangedFile[];
	failures: string[];
	image?: { ref: string; lines: string[] };
	usage: { fiveHour?: number; sevenDay?: number; contextPercent?: number; contextTokens?: number; contextWindow?: number; model: string; thinking: string };
}

export const PANEL_WIDTH = 40;

/** `git status --porcelain` → status letter (untracked counts as added) and path (renames: the new one). */
export function parsePorcelain(output: string): ChangedFile[] {
	return output
		.split("\n")
		.filter((line) => line.length > 3)
		.map((line) => {
			const code = line.slice(0, 2);
			const status = code === "??" ? "A" : (code.trim()[0] ?? "M");
			return { status, path: line.slice(3).split(" -> ").pop() ?? line.slice(3) };
		});
}

/** `git diff --numstat` → added/removed lines per path (binary files count 0). */
export function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	for (const line of output.split("\n")) {
		const [added, removed, path] = line.split("\t");
		if (path) counts.set(path, { added: Number(added) || 0, removed: Number(removed) || 0 });
	}
	return counts;
}

const bar = (fraction: number | undefined, cells = 10) => {
	const filled = Math.round(Math.min(1, Math.max(0, fraction ?? 0)) * cells);
	return fg(C.cyan, "▰".repeat(filled)) + fg(C.faint, "▱".repeat(cells - filled));
};

export function renderPanel(info: PanelInfo, width: number): string[] {
	const inner = width - 2;
	const section = (title: string, right = "") => {
		const head = `${bold(fg(C.text, title))} `;
		const tail = right ? ` ${right}` : "";
		return head + fg(C.border, "─".repeat(Math.max(1, inner - visibleWidth(head) - visibleWidth(tail)))) + tail;
	};
	const lines: string[] = [fit(bold(fg(C.mag, "PANNELLO")), `${fg(C.text, "alt+i")} ${fg(C.dim, "chiudi")}`, inner), section("SESSIONE")];

	const session = [
		["goal", "GOAL", C.mag],
		["loop", "LOOP", C.cyan],
		["team", "TEAM", C.yel],
	] as const;
	const rows = session.flatMap(([key, tag, color]) => {
		const text = info.session.get(key)?.replace(new RegExp(`^${key}\\s*`, "i"), "");
		return text ? [`${bold(fg(color, tag))} ${fg(C.text, text)}`] : [];
	});
	lines.push(...(rows.length ? rows : [fg(C.dim, "nessun goal, loop o team")]));

	if (info.files.length) {
		lines.push("", section("FILE", fg(C.yel, `✚${info.files.length}`)));
		for (const file of info.files.slice(0, 6)) {
			const color = file.status === "A" ? C.ok : file.status === "D" ? C.err : C.warn;
			const counts = `${file.added ? fg(C.add, `+${file.added}`) : ""}${file.removed ? ` ${fg(C.del, `-${file.removed}`)}` : ""}`.trim();
			lines.push(fit(`${fg(color, file.status)} ${fg(C.cyan, underline(file.path))}`, counts, inner));
		}
		if (info.files.length > 6) lines.push(fg(C.dim, `… altri ${info.files.length - 6}`));
	}
	if (info.failures.length) {
		lines.push("", section("TEST", fg(C.err, `${info.failures.length} ✗`)));
		for (const failure of info.failures.slice(0, 4)) lines.push(`${fg(C.err, "✗")} ${fg(C.text, failure)}`);
	}
	if (info.image) {
		lines.push("", section("IMMAGINI"), ...info.image.lines, fit(fg(C.cyan, underline(info.image.ref)), `${fg(C.mag, "/img")}`, inner));
	}
	const usage = info.usage;
	const percent = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value)}%`);
	lines.push(
		"",
		section("USO"),
		`${bold(fg(C.text, "5H "))} ${bar(usage.fiveHour)} ${fg(C.text, percent(usage.fiveHour === undefined ? undefined : usage.fiveHour * 100))}`,
		`${bold(fg(C.text, "7G "))} ${bar(usage.sevenDay)} ${fg(C.text, percent(usage.sevenDay === undefined ? undefined : usage.sevenDay * 100))}`,
		`${bold(fg(C.text, "CTX"))} ${bar(usage.contextPercent === undefined ? undefined : usage.contextPercent / 100)} ${fg(C.text, percent(usage.contextPercent))}`,
		fg(C.dim, `    ${usage.contextTokens !== undefined && usage.contextWindow ? `${formatTokens(usage.contextTokens).replace(",0k", "k")}/${formatTokens(usage.contextWindow).replace(",0k", "k")} · ` : ""}${usage.model}·${usage.thinking}`),
	);
	// Panel background with a magenta edge, every line exactly `width` columns.
	return lines.map((line) => `${fg(C.mag, "▌")}${bg(C.panel, ` ${pad(truncateToWidth(line, inner, "…"), inner)}`)}`);
}
