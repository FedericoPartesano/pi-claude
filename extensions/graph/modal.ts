/**
 * Fixed modal of a /graph job: title, progress bar, token line, a live log of what graphify prints, and a key hint.
 * Esc cancels while the job runs; when it ends the result stays on screen until Enter or Esc closes it.
 * Pure rendering plus a small state machine, so it is testable without a terminal.
 */
import { type Progress, progressLines } from "./progress.ts";

const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width));

export class JobModal {
	readonly abort = new AbortController();
	progress: Progress;
	/** Free line under the token line (for example the documents already in graphify's cache). */
	extra = "";
	result: string | undefined;
	private lines: { at: number; text: string }[] = [];
	private redraw: () => void = () => {};
	private close: () => void = () => {};
	private closed = false;

	readonly title: string;
	private readonly now: () => number;
	private readonly rows: () => number;

	constructor(title: string, now: () => number = Date.now, rows: () => number = () => process.stdout.rows || 30) {
		this.title = title;
		this.now = now;
		this.rows = rows;
		this.progress = { title, phase: "avvio", done: 0, total: 1, input: 0, output: 0, cost: 0, startedAt: now(), now: now() };
	}

	/** Wires the modal to the terminal: how to redraw and how to close. */
	attach(redraw: () => void, close: () => void): void {
		this.redraw = redraw;
		this.close = close;
		if (this.closed) close();
	}

	set(patch: Partial<Progress>): void {
		Object.assign(this.progress, patch);
		this.redraw();
	}

	log(text: string): void {
		const line = text.trim();
		if (!line) return;
		this.lines.push({ at: this.now(), text: line });
		if (this.lines.length > 500) this.lines.shift();
		this.redraw();
	}

	/** Ends the job: the result replaces the hint and the modal waits for a key. */
	finish(result: string): void {
		this.result = result;
		this.log("— fine —");
	}

	get running(): boolean {
		return this.result === undefined;
	}

	handleInput(data: string): void {
		const escape = data === "\x1b";
		if (this.running) {
			if (escape && !this.abort.signal.aborted) {
				this.abort.abort();
				this.log("Annullamento richiesto…");
			}
			return;
		}
		if (escape || data === "\r" || data === "\n" || data === " ") {
			this.closed = true;
			this.close();
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(20, Math.min(width, 110) - 4);
		const head = progressLines({ ...this.progress, now: this.now(), title: this.title }, false);
		const body = [...head, ...(this.extra ? [this.extra] : [])];
		const logRoom = Math.max(4, Math.min(16, this.rows() - body.length - 10));
		const log = this.lines.slice(-logRoom).map((line) => `${clock(line.at)} ${line.text}`);
		while (log.length < logRoom) log.push("");
		const footer = this.running ? (this.abort.signal.aborted ? "Annullamento in corso…" : "Esc annulla") : "Invio o Esc per chiudere";
		const result = this.result ? ["", ...this.result.split("\n")] : [];
		const rows = [...body, "─".repeat(inner), ...log, ...(result.length ? ["─".repeat(inner), ...result] : []), "─".repeat(inner), footer];
		return [`╭─ ${this.title} ${"─".repeat(Math.max(0, inner - this.title.length - 1))}╮`, ...rows.map((row) => `│ ${fit(row, inner)} │`), `╰${"─".repeat(inner + 2)}╯`];
	}
}
