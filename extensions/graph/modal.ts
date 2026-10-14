/**
 * Modal of /graph, drawn with the pi theme like the other windows (border, accent, muted, success, error).
 *   Lavoro     progress bar, token, time, cache and live log of a build/update/semantic job
 *   Interroga  a question box over the graph; the answer is laid out (nodes, links, hints), not dumped raw
 * Tab switches tab. While a job runs Esc cancels it; afterwards Esc (or Enter on Lavoro) closes the modal.
 * Plain rendering plus a small state machine, so it is testable without a terminal.
 */
import { type Progress, bar, compact, duration } from "./progress.ts";

export type Tab = "lavoro" | "interroga";

/** Same shape as pi's theme; without one the modal renders as plain text (tests, no colors). */
export interface ModalTheme {
	fg(role: "accent" | "muted" | "dim" | "text" | "success" | "warning" | "error" | "border", text: string): string;
	bold(text: string): string;
}

export const PLAIN: ModalTheme = { fg: (_role, text) => text, bold: (text) => text };

const ANSI = /\x1b\[[0-9;]*m/g;
const visibleWidth = (text: string) => text.replace(ANSI, "").length;
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
/** Cuts to `width` visible characters (cuts before styling is applied, so it is meant for plain text). */
const cut = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text);
const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);

const KEYS: Record<string, string[]> = { tab: ["\t"], escape: ["\x1b"], enter: ["\r", "\n"], backspace: ["\x7f", "\b"], up: ["\x1b[A", "\x1bOA"], down: ["\x1b[B", "\x1bOB"], pageUp: ["\x1b[5~"], pageDown: ["\x1b[6~"] };
const matchesKey = (data: string, key: string) => KEYS[key]?.includes(data) ?? false;
/** Printable text typed (also a paste); undefined for control sequences. */
const printable = (data: string): string | undefined => (data.length > 0 && !/[\x00-\x1f\x7f]/.test(data) ? data : undefined);

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
	/** Short text next to the title (for example the graph size), read at every redraw. */
	info?: () => string;
	theme?: ModalTheme;
	now?: () => number;
	rows?: () => number;
}

export class JobModal {
	readonly abort = new AbortController();
	readonly title: string;
	progress: Progress;
	/** Free line under the time line (for example the documents already in graphify's cache). */
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
	private readonly infoFn: ModalOptions["info"];
	private t: ModalTheme;
	private readonly now: () => number;
	private readonly rows: () => number;
	private redraw: () => void = () => {};
	private close: () => void = () => {};
	private closed = false;

	constructor(title: string, options: ModalOptions = {}) {
		this.title = title;
		this.hasJob = options.job ?? true;
		this.askFn = options.ask;
		this.infoFn = options.info;
		this.t = options.theme ?? PLAIN;
		this.now = options.now ?? Date.now;
		this.rows = options.rows ?? (() => process.stdout.rows || 30);
		this.tab = this.hasJob ? "lavoro" : "interroga";
		this.progress = { title, phase: "avvio", done: 0, total: 1, input: 0, output: 0, cost: 0, startedAt: this.now(), now: this.now() };
	}

	/** Gives the modal the theme of the running pi (known only once the terminal opens it). */
	theme(theme: ModalTheme): void {
		this.t = theme;
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
		const typed = printable(data);
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

	/** "key label · key label": keys in accent, labels muted. */
	private hints(pairs: [string, string][]): string {
		return pairs.map(([key, label]) => `${this.t.fg("accent", key)} ${this.t.fg("muted", label)}`).join(this.t.fg("dim", "  ·  "));
	}

	render(width: number): string[] {
		const t = this.t;
		const inner = Math.max(40, width - 4);
		const room = Math.max(12, Math.min(22, this.rows() - 8));
		const body = this.tab === "lavoro" ? this.workBody(inner, room) : this.askBody(inner, room);
		while (body.length < room) body.push("");
		const border = (text: string) => t.fg("border", text);
		const row = (text: string) => `${border("│")} ${pad(text, inner)} ${border("│")}`;

		const info = this.infoFn?.() ?? "";
		const title = `${t.fg("accent", t.bold(` ${this.title} `))}`;
		const top = `${border("╭─")}${title}${border("─".repeat(Math.max(1, inner + 1 - visibleWidth(` ${this.title} `) - (info ? info.length + 3 : 0))))}${info ? `${t.fg("muted", ` ${info} `)}${border("─")}` : ""}${border("╮")}`;

		const tabs = this.tabs
			.map((tab) => (tab.id === this.tab ? t.fg("accent", t.bold(`▌ ${tab.label} ▐`)) : t.fg("muted", `  ${tab.label}  `)))
			.join(" ");

		const stop = this.running ? this.hints([["Esc", this.abort.signal.aborted ? "annullamento in corso…" : "annulla il lavoro"]]) : undefined;
		const keys: [string, string][] = this.tab === "lavoro" ? [["Invio o Esc", "chiude"]] : this.input ? [["Invio", "chiede"], ["Esc", "cancella la riga"]] : [["Invio", "chiede"], ["↑↓", "scorrono"], ["Esc", "chiude"]];
		const hint = stop ?? this.hints(this.running ? [] : keys);
		const more = this.tabs.length > 1 ? `${t.fg("dim", "  ·  ")}${this.hints([["Tab", "cambia scheda"]])}` : "";
		return [top, row(tabs), `${border("├")}${border("─".repeat(inner + 2))}${border("┤")}`, ...body.slice(0, room).map(row), `${border("├")}${border("─".repeat(inner + 2))}${border("┤")}`, row(`${hint}${more}`), border(`╰${"─".repeat(inner + 2)}╯`)];
	}

	/** "label   value" with a fixed label column so the figures line up. */
	private field(label: string, value: string): string {
		return `${this.t.fg("muted", label.padEnd(9))}${value}`;
	}

	private workBody(inner: number, room: number): string[] {
		const t = this.t;
		const p = this.progress;
		const now = this.now();
		const fraction = p.total > 0 ? Math.max(0, Math.min(1, p.done / p.total)) : 0;
		const elapsed = now - p.startedAt;
		const left = p.done > 0 && p.done < p.total ? ` · restano ~${duration((elapsed / p.done) * (p.total - p.done))}` : "";
		const width = Math.max(10, Math.min(48, inner - 22));
		const filled = Math.round(fraction * width);
		const done = this.result !== undefined;
		const color = done ? "success" : this.abort.signal.aborted ? "warning" : "accent";
		const meter = `${t.fg(color, "█".repeat(filled))}${t.fg("dim", "░".repeat(width - filled))}`;
		const tokens = p.input || p.output ? `${compact(p.input)} in · ${compact(p.output)} out · $${p.cost.toFixed(4)}` : "nessuno in questa fase (solo codice)";
		const head = [
			`${t.fg("text", t.bold(cut(p.phase, inner - 4)))}${p.current ? t.fg("dim", `  ${cut(p.current, Math.max(10, inner - p.phase.length - 6))}`) : ""}`,
			`${meter}  ${t.bold(`${Math.round(fraction * 100)}%`)}  ${t.fg("muted", `${p.done}/${p.total}`)}`,
			"",
			this.field("Token", tokens),
			this.field("Tempo", `${duration(elapsed)}${left}${p.failed ? t.fg("warning", ` · ${p.failed} non letti`) : ""}`),
			...(this.extra ? [this.field("Cache", this.extra.replace(/^Cache:\s*/i, ""))] : []),
		].map((line) => (visibleWidth(line) > inner ? cut(line.replace(ANSI, ""), inner) : line));

		const result = this.result
			? [
					t.fg("border", "─".repeat(inner)),
					...wrap(this.result, inner - 2).map((line, index) => `${t.fg(/non|errore|annullat|fallit/i.test(this.result ?? "") ? "warning" : "success", index === 0 ? "✔ " : "  ")}${t.fg("text", line)}`),
				]
			: [];
		const logRoom = Math.max(2, room - head.length - result.length - 2);
		const log = this.lines.slice(-logRoom).map((line) => {
			const tone = /error|errore|fail|fallit|traceback/i.test(line.text) ? "error" : /warn|attenz|annull/i.test(line.text) ? "warning" : "muted";
			return `${t.fg("dim", clock(line.at))}  ${t.fg(tone, cut(line.text, inner - 10))}`;
		});
		return [...head, t.fg("dim", `Registro ${"─".repeat(Math.max(0, inner - 9))}`), ...log, ...Array(Math.max(0, logRoom - log.length)).fill(""), ...result];
	}

	/** Lays out graphify's text answer: nodes bold with their file dim, links with colored arrows, hints muted. */
	private decorate(line: string): string {
		const t = this.t;
		const node = /^NODE (.+?) \[src=(\S+?)(?: loc=\S+)?(?: community=(.+?))?\]$/.exec(line);
		if (node) return `${t.fg("accent", "◆ ")}${t.bold(node[1])}  ${t.fg("dim", node[2])}${node[3] ? t.fg("muted", `  ⬡ ${node[3]}`) : ""}`;
		const edge = /^EDGE (.+?) --(\S+) \[(\w+)[^\]]*\]--> (.+?)(?: at=(\S+))?$/.exec(line);
		if (edge) return `${t.fg("muted", "  ")}${t.fg("text", edge[1])} ${t.fg(edge[3] === "EXTRACTED" ? "success" : "warning", `─${edge[2]}→`)} ${t.fg("text", edge[4])}${edge[5] ? t.fg("dim", `  ${edge[5]}`) : ""}`;
		const link = /^(\s+)(<--|-->) (.+?) \[(\w+)\] \[(\w+)\](.*)$/.exec(line);
		if (link) return `${link[1]}${t.fg(link[5] === "EXTRACTED" ? "success" : "warning", link[2] === "<--" ? "←" : "→")} ${t.fg("text", link[3])} ${t.fg("muted", link[4])}${t.fg("dim", link[6])}`;
		if (/^\[i\]|^Graph:|^Shortest path/.test(line)) return t.fg("muted", line);
		const field = /^(\s{2}[A-Za-z]+:)(\s+.*)$/.exec(line);
		if (field) return `${t.fg("muted", field[1])}${t.fg("text", field[2])}`;
		if (/^Node:|^Connections|^Errore/.test(line)) return t.fg(/^Errore/.test(line) ? "error" : "accent", t.bold(line));
		return t.fg("text", line);
	}

	private askBody(inner: number, room: number): string[] {
		const t = this.t;
		const field = inner - 4;
		const typed = this.input.length > field - 3 ? `…${this.input.slice(-(field - 4))}` : this.input;
		const line = `${t.fg("accent", "›")} ${typed ? t.fg("text", typed) : t.fg("dim", "scrivi una domanda…")}${typed ? t.fg("accent", "▏") : ""}`;
		const box = [t.fg("accent", `╭${"─".repeat(field)}╮`), `${t.fg("accent", "│")} ${pad(line, field - 2)} ${t.fg("accent", "│")}`, t.fg("accent", `╰${"─".repeat(field)}╯`)].map((text) => `  ${text}`);

		const space = Math.max(3, room - box.length - 2);
		let content: string[];
		if (this.busy) content = [t.fg("accent", "  Cerco nel grafo…")];
		else if (!this.answer) {
			content = [
				t.fg("muted", "  Cosa puoi chiedere"),
				"",
				`  ${t.fg("accent", "come funziona il recall")}  ${t.fg("dim", "ricerca libera nel grafo")}`,
				`  ${t.fg("accent", "spiega memory.ts")}  ${t.fg("dim", "un file o un simbolo e i suoi collegamenti")}`,
				`  ${t.fg("accent", "percorso recall.ts store.ts")}  ${t.fg("dim", "come due nodi sono collegati")}`,
			];
		} else content = wrap(this.answer, inner - 2).map((line) => `  ${this.decorate(line)}`);

		const top = Math.min(this.scroll, Math.max(0, content.length - space));
		this.scroll = top;
		const shown = content.slice(top, top + space);
		const asked = this.asked && this.answer ? `  ${t.fg("muted", "Risposta a:")} ${t.bold(cut(this.asked, inner - 16))}` : "";
		const counter = content.length > space && this.answer ? t.fg("dim", `  righe ${top + 1}-${top + shown.length} di ${content.length}`) : "";
		return [...box, asked, ...shown, ...Array(Math.max(0, space - shown.length)).fill(""), counter].slice(0, room);
	}
}
