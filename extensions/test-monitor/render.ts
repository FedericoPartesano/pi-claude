/**
 * Live test monitor: a small panel above the editor (not in the chat) while a test command runs. A dot per finished test
 * (green passed, red failed, a spinner for the one running), counters, the clock and the latest test name. When the run
 * ends it turns into a one-glance verdict and goes away by itself. Fed by the runner adapters (runners.ts).
 */
import type { Progress } from "./progress.ts";

/** The colours the monitor uses (a subset of pi-ui's palette, which the extension loads when it runs inside Pi). */
export interface Colors {
	ok: string;
	err: string;
	cyan: string;
	dim: string;
	text: string;
	faint: string;
	panel: string;
	warn: string;
}

export const DEFAULT_COLORS: Colors = { ok: "#3df2a0", err: "#ff4d6d", cyan: "#2ee6ff", dim: "#858ba0", text: "#dcdfe8", faint: "#4c5163", panel: "#13121a", warn: "#ffd166" };
export let C: Colors = DEFAULT_COLORS;
export const useColors = (colors: Colors) => {
	C = colors;
};

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(";");
export const fg = (color: string, text: string) => `\x1b[38;2;${rgb(color)}m${text}\x1b[39m`;
export const bg = (color: string, text: string) => `\x1b[48;2;${rgb(color)}m${text}\x1b[49m`;
export const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

// pi-tui is not importable from an extension (it exists only inside Pi): the glyphs used here are one cell wide.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/y;
export const visibleWidth = (text: string) => [...text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")].length;
/** Cuts to `width` cells keeping escape codes whole, and closes any open colour. */
export function truncateToWidth(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	let out = "";
	let cells = 0;
	for (let i = 0; i < text.length && cells < width - 1; ) {
		ANSI.lastIndex = i;
		const code = ANSI.exec(text);
		if (code) {
			out += code[0];
			i += code[0].length;
			continue;
		}
		const char = String.fromCodePoint(text.codePointAt(i)!);
		out += char;
		i += char.length;
		cells++;
	}
	return `${out}…\x1b[0m`;
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface TestRun extends Progress {
	command: string;
	startedAt: number;
	endedAt?: number;
	/** Estimated number of tests (see estimateTotal); grows if more results arrive. */
	total?: number;
}

export const newTestRun = (command: string, startedAt: number): TestRun => ({ command, startedAt, pass: 0, fail: 0, results: [], failed: [] });

/** The command as the user typed it: without the `| tee '<file>'` that Pi inserted. */
export const shownCommand = (command: string) =>
	command
		.replace(/\s*\|\s*tee '(?:[^']|'\\'')*'/, "")
		.replace(/ --reporters=default --reporters='[^']*'/, "")
		.replace(/ --reporter=verbose/, "").replace(/\s+/g, " ").trim();

export const duration = (ms: number) => {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};

/** The three-row frame every monitor view shares: coloured left bar, panel background, text cut to the width. */
export function panel(color: string, width: number) {
	const row = (body: string) => {
		const cut = truncateToWidth(body, width - 1);
		return `${fg(color, "▌")}${bg(C.panel, cut + " ".repeat(Math.max(0, width - 1 - visibleWidth(cut))))}`;
	};
	const split = (left: string, right: string) => `${left}${" ".repeat(Math.max(1, width - 2 - visibleWidth(left) - visibleWidth(right)))}${right} `;
	return { row, split };
}

/** Narrow hosts (side panel): title and clock, a progress bar like the usage bars, counters, the latest test or the verdict. */
function renderNarrow(run: TestRun, width: number, now: number, frame: number): string[] {
	const done = run.endedAt !== undefined;
	const bad = run.fail > 0;
	const color = done ? (bad ? C.err : C.ok) : C.cyan;
	const finished = run.results.length;
	const total = Math.max(run.total ?? 0, finished);
	const split = (left: string, right: string) => `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`;
	const title = bold(fg(color, done ? (bad ? "✖ FAILED" : "✔ PASSED") : `${SPINNER[frame % SPINNER.length]} RUNNING`));
	const rows = [split(title, fg(C.dim, duration((run.endedAt ?? now) - run.startedAt)))];
	if (run.total) {
		const cells = Math.max(4, width - 5);
		const filled = Math.min(cells, Math.round((finished / total) * cells));
		const pct = Math.round((finished / total) * 100);
		rows.push(`${fg(bad ? C.err : C.ok, "▰".repeat(filled))}${fg(C.faint, "▱".repeat(cells - filled))} ${fg(C.dim, `${pct}%`.padStart(3))}`);
	}
	rows.push(`${fg(C.ok, `${run.pass} ok`)}${bad ? `${fg(C.dim, " · ")}${fg(C.err, `${run.fail} ko`)}` : ""}${run.total ? fg(C.dim, ` · ${finished}/${total}`) : ""}`);
	if (done && bad) for (const name of run.failed.slice(0, 3)) rows.push(fg(C.err, truncateToWidth(`· ${name}`, width)));
	else if (!done) rows.push(run.last ? `${fg(C.dim, "› ")}${fg(C.text, truncateToWidth(run.last, width - 2))}` : fg(C.dim, "waiting for the first result…"));
	return rows;
}

export function renderTestMonitor(run: TestRun, width: number, now: number, frame: number, compact = false): string[] {
	if (compact) return renderNarrow(run, width, now, frame);
	const done = run.endedAt !== undefined;
	const bad = run.fail > 0;
	const color = done ? (bad ? C.err : C.ok) : C.cyan;
	// Not `tag()`: its background would end the panel background mid-row.
	const row = (body: string) => `${fg(color, "▌")}${bg(C.panel, truncateToWidth(body, width - 1) + " ".repeat(Math.max(0, width - 1 - visibleWidth(truncateToWidth(body, width - 1)))))}`;
	const split = (left: string, right: string) => `${left}${" ".repeat(Math.max(1, width - 2 - visibleWidth(left) - visibleWidth(right)))}${right} `;
	const clock = fg(C.dim, duration((run.endedAt ?? now) - run.startedAt));
	const verdict = done ? (bad ? "FAILED" : "PASSED") : "RUNNING";
	const head = ` ${bold(fg(color, `◈ TESTS ${verdict}`))}  ${fg(C.dim, truncateToWidth(shownCommand(run.command), Math.max(8, width - 28)))}`;

	const finished = run.results.length;
	const total = Math.max(run.total ?? 0, finished);
	const counts = `${fg(C.ok, `${run.pass} ok`)}${bad ? fg(C.dim, " · ") + fg(C.err, `${run.fail} ko`) : ""}${total > finished || (run.total && !done) ? fg(C.dim, ` · ${finished}/${total}`) : ""}`;
	const spin = done ? "" : ` ${fg(color, SPINNER[frame % SPINNER.length])}`;
	const room = Math.max(4, width - 4 - visibleWidth(counts) - (done ? 0 : 2));
	let dots: string;
	if (total > 0 && run.total) {
		// Every test is a grey dot up front; it turns green or red as its result arrives. Too many: a cell stands for several.
		const per = Math.ceil(total / room);
		const cells = Math.ceil(total / per);
		dots = Array.from({ length: cells }, (_, cell) => {
			const slice = run.results.slice(cell * per, (cell + 1) * per);
			if (slice.length < Math.min(per, total - cell * per)) return fg(C.faint, "●");
			return slice.includes("f") ? fg(C.err, "✖") : fg(C.ok, "●");
		}).join("");
	} else {
		const shown = run.results.slice(-room);
		dots = `${run.results.length > room ? fg(C.faint, "…") : ""}${shown.map((r) => fg(r === "p" ? C.ok : C.err, r === "p" ? "●" : "✖")).join("")}`;
	}
	dots += spin;

	const detail = done
		? bad
			? fg(C.err, truncateToWidth(`✖ ${run.failed.slice(0, 3).join(" · ")}${run.failed.length > 3 ? ` · +${run.failed.length - 3}` : ""}`, width - 4))
			: fg(C.ok, run.pass ? `✔ all ${run.pass} passing` : "✔ finished")
		: run.last
			? `${fg(C.dim, "last ")}${fg(C.text, truncateToWidth(run.last, width - 12))}`
			: fg(C.dim, "waiting for the first result…");
	return [row(split(head, clock)), row(split(` ${dots}`, counts)), row(` ${detail}`)];
}
