/**
 * Modal of /graph: a title, a tab bar and a fixed-size body, so it does not jump while it fills.
 *   Lavoro     progress bar, tokens, time, live log of a build/update/semantic job (only when a job runs or ran)
 *   Interroga  a question box over the graph: free text asks, "spiega <nodo>" explains, "percorso <A> <B>" links two nodes
 * Tab switches tab. While a job runs Esc cancels it; afterwards Esc (or Enter on Lavoro) closes the modal.
 * Pure rendering plus a small state machine, so it is testable without a terminal.
 */
import { type Progress, progressLines } from "./progress.ts";

export type Tab = "lavoro" | "interroga";

const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);
const visibleWidth = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").length;
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
const KEYS: Record<string, string[]> = { tab: ["\t"], escape: ["\x1b"], enter: ["\r", "\n"], backspace: ["\x7f", "\b"], up: ["\x1b[A", "\x1bOA"], down: ["\x1b[B", "\x1bOB"], pageUp: ["\x1b[5~"], pageDown: ["\x1b[6~"] };
const matchesKey = (data: string, key: string) => KEYS[key]?.includes(data) ?? false;
/** Printable text typed (also a paste); undefined for control sequences. */
const decodeKittyPrintable = (data: string): string | undefined => (data.length > 0 && !/[\x00-\x1f\x7f]/.test(data) ? data : undefined);
const cut = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text);
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const invert = (text: string) => `\x1b[7m${text}\x1b[27m`;

/** Hard-wraps plain text to `width`, keeping blank lines and breaking at spaces when it can. */
export function wrap(text: string, width: number): string[] {
	const out: string[] = [];
	for (const raw of text.split("\n")) {
		let line = raw.replace(/\t/g, "  ");
		if (!line) out.push("");
		while (line.length > width) {
			const space = line.lastIndexOf(" ", width);
			const at = space > width * 0.4 ? space : width;
			out.push(line.slice(0, at));
			line = line.slice(at).trimStart();
		}
		if (line) out.push(line);
	}
	return out;
}

/** How a typed line is asked: "spiega X", "percorso A B" (or "A -> B"), anything else is a search. */
export function parseAsk(text: string): { kind: "query"; text: string } | { kind: "explain"; name: string } | { kind: "path"; from: string; to: string } | undefined {
	const value = text.trim();
	if (!value) return undefined;
	const explain = /^(?:spiega|explain)\s+(.+)$/i.exec(value);
	if (explain) return { kind: "explain", name: explain[1].trim() };
	const path = /^(?:percorso|path)\s+(.+?)\s+(?:->|→|a|to)\s+(.+)$/i.exec(value) ?? /^(?:percorso|path)\s+(\S+)\s+(\S+)$/i.exec(value);
	if (path) return { kind: "path", from: path[1].trim(), to: path[2].trim() };
	return { kind: "query", text: value };
}

export interface ModalOptions {
	/** True when a job (build, update, semantic) drives the Lavoro tab; false opens on Interroga alone. */
	job?: boolean;
	/** Answers a typed line; sync or async. Without it the Interroga tab is not shown. */
	ask?: (text: string) => string | Promise<string>;
	now?: () => number;
	rows?: () => number;
}

export class JobModal {
	readonly abort = new AbortController();
	readonly title: string;
	progress: Progress;
	/** Free line under the token line (for example the documents already in graphify's cache). */
	extra = "";
	result: string | undefined;
	tab: Tab;
	input = "";
	answer = "";
	asked = "";
	busy = false;
	private scroll = 0;
	private lines: { at: number; text: string }[] = [];
	private readonly hasJob: boolean;
	private readonly askFn: ModalOptions["ask"];
	private readonly now: () => number;
	private readonly rows: () => number;
	private redraw: () => void = () => {};
	private close: () => void = () => {};
	private closed = false;

	constructor(title: string, options: ModalOptions = {}) {
		this.title = title;
		this.hasJob = options.job ?? true;
		this.askFn = options.ask;
		this.now = options.now ?? Date.now;
		this.rows = options.rows ?? (() => process.stdout.rows || 30);
		this.tab = this.hasJob ? "lavoro" : "interroga";
		this.progress = { title, phase: "avvio", done: 0, total: 1, input: 0, output: 0, cost: 0, startedAt: this.now(), now: this.now() };
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

	/** Ends the job: the result stays on Lavoro and the modal waits for a key. */
	finish(result: string): void {
		this.result = result;
		this.log("— fine —");
	}

	get running(): boolean {
		return this.hasJob && this.result === undefined;
	}

	private get tabs(): { id: Tab; label: string }[] {
		return [...(this.hasJob ? [{ id: "lavoro" as Tab, label: this.running ? "Lavoro ●" : "Lavoro" }] : []), ...(this.askFn ? [{ id: "interroga" as Tab, label: "Interroga" }] : [])];
	}

	private async submit(): Promise<void> {
		const text = this.input.trim();
		if (!text || !this.askFn || this.busy) return;
		this.busy = true;
		this.asked = text;
		this.answer = "";
		this.scroll = 0;
		this.redraw();
		await new Promise((resolve) => setTimeout(resolve, 0));
		try {
			this.answer = await this.askFn(text);
		} catch (error) {
			this.answer = `Errore: ${error instanceof Error ? error.message : String(error)}`;
		}
		this.busy = false;
		this.input = "";
		this.redraw();
	}

	handleInput(data: string): void {
		const tabs = this.tabs;
		if (matchesKey(data, "tab") && tabs.length > 1) {
			this.tab = tabs[(tabs.findIndex((tab) => tab.id === this.tab) + 1) % tabs.length].id;
			return this.redraw();
		}
		if (this.running && matchesKey(data, "escape")) {
			if (!this.abort.signal.aborted) {
				this.abort.abort();
				this.log("Annullamento richiesto…");
			}
			return;
		}
		if (this.tab === "lavoro") {
			if (!this.running && (matchesKey(data, "escape") || matchesKey(data, "enter") || data === " ")) return this.shut();
			return;
		}
		if (matchesKey(data, "escape")) return this.input ? ((this.input = ""), this.redraw()) : this.running ? undefined : this.shut();
		if (matchesKey(data, "enter")) return void this.submit();
		if (matchesKey(data, "backspace")) return ((this.input = this.input.slice(0, -1)), this.redraw());
		if (matchesKey(data, "up")) return ((this.scroll = Math.max(0, this.scroll - 1)), this.redraw());
		if (matchesKey(data, "down")) return ((this.scroll += 1), this.redraw());
		if (matchesKey(data, "pageUp")) return ((this.scroll = Math.max(0, this.scroll - 8)), this.redraw());
		if (matchesKey(data, "pageDown")) return ((this.scroll += 8), this.redraw());
		const typed = decodeKittyPrintable(data);
		if (typed) {
			this.input += typed;
			this.redraw();
		}
	}

	private shut(): void {
		this.closed = true;
		this.close();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(30, Math.min(width, 110) - 4);
		const room = Math.max(10, Math.min(24, this.rows() - 9));
		const body = this.tab === "lavoro" ? this.workBody(inner, room) : this.askBody(inner, room);
		while (body.length < room) body.push("");
		const rule = dim("─".repeat(inner));
		const hint = this.running ? (this.abort.signal.aborted ? "Annullamento in corso…" : "Esc annulla il lavoro") : this.tab === "lavoro" ? "Invio o Esc chiude" : this.input ? "Invio chiede · Esc cancella la riga" : "Esc chiude";
		const other = this.tabs.length > 1 ? " · Tab cambia scheda" : "";
		const bar = this.tabs.map((tab) => (tab.id === this.tab ? invert(` ${tab.label} `) : dim(` ${tab.label} `))).join(" ");
		const rows = [bar, rule, ...body.slice(0, room), rule, dim(cut(`${hint}${other}`, inner))];
		const head = ` ${this.title} `;
		return [`╭─${bold(head)}${"─".repeat(Math.max(0, inner + 1 - visibleWidth(head)))}╮`, ...rows.map((row) => `│ ${pad(row, inner)} │`), `╰${"─".repeat(inner + 2)}╯`];
	}

	private workBody(inner: number, room: number): string[] {
		const head = [...progressLines({ ...this.progress, now: this.now(), title: this.title }, false), ...(this.extra ? [this.extra] : [])].map((line) => cut(line, inner));
		const result = this.result ? ["", ...wrap(this.result, inner)] : [];
		const logRoom = Math.max(2, room - head.length - result.length - 1);
		const log = this.lines.slice(-logRoom).map((line) => cut(`${dim(clock(line.at))} ${line.text}`, inner + 9));
		return [...head, dim("─".repeat(inner)), ...log, ...(result.length ? [] : []), ...Array(Math.max(0, logRoom - log.length)).fill(""), ...result];
	}

	private askBody(inner: number, room: number): string[] {
		const cursor = this.busy ? "" : "▏";
		const prompt = `› ${this.input || dim("scrivi una domanda…")}${this.input ? cursor : ""}`;
		const help = dim('Esempi: "come funziona il recall" · "spiega memory.ts" · "percorso recall.ts store.ts"');
		const wrapped = this.busy ? ["Cerco nel grafo…"] : wrap(this.answer || "", inner);
		const space = Math.max(1, room - 4);
		const top = Math.min(this.scroll, Math.max(0, wrapped.length - space));
		this.scroll = top;
		const shown = wrapped.slice(top, top + space);
		const counter = wrapped.length > space ? dim(`righe ${top + 1}-${top + shown.length} di ${wrapped.length} · ↑↓ PgSu PgGiù scorrono`) : "";
		return [cut(prompt, inner + 8), help, this.asked ? bold(cut(`Risposta a: ${this.asked}`, inner)) : "", ...shown, ...Array(Math.max(0, space - shown.length)).fill(""), counter].slice(0, room);
	}
}
