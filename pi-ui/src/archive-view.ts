/**
 * The /archivio full-screen view: three tabs over the history that compaction took out of the live context.
 * Injections (what rode along with each prompt, and why), Entries (everything archived), Test (type a question and see
 * the semantic ranking with the z-score the automatic recall would use). Tab/shift+tab switch, ↑↓ move,
 * PgUp/PgDn scroll the detail, Esc closes.
 */
import { CURSOR_MARKER, decodeKittyPrintable, type Component, type Focusable, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Shapes of `extensions/archivio.ts` (kept structural: this module must not pull the extension API into pi-ui). */
export interface ArchiveOverview {
	entries: { id: string; role: string; label: string; chars: number; preview: string; injected: number }[];
	injections: { at: string; prompt: string; method: string; hits: { id: string; label: string; z?: number }[]; text: string }[];
	compactions: number;
}
export interface Hit {
	entryId: string;
	label: string;
	text: string;
	score: number;
	z?: number;
}

export interface ViewTheme {
	fg(role: "accent" | "muted" | "dim" | "text" | "success" | "warning" | "error" | "border", text: string): string;
	bold(text: string): string;
}

export interface ViewStatus {
	chunks: number;
	vectors: number;
	semantic: boolean;
	threshold: number;
}

type Tab = "iniezioni" | "voci" | "prova";
const TABS: { id: Tab; label: string }[] = [
	{ id: "iniezioni", label: "Iniezioni" },
	{ id: "voci", label: "Voci" },
	{ id: "prova", label: "Prova" },
];

interface Row {
	title: string;
	detail: string;
	flag?: "ok" | "warn";
	/** Archived entry to open whole (voci tab and hits). */
	open?: string;
}

export class ArchiveView implements Component, Focusable {
	focused = false;
	private tab: Tab = "iniezioni";
	private index = new Map<Tab, number>([["iniezioni", 0], ["voci", 0], ["prova", 0]]);
	private scroll = 0;
	private query = "";
	private results: Row[] = [];
	private note = "";
	private busy = false;
	private readonly opened = new Map<string, string>();

	private readonly theme: ViewTheme;
	private readonly overview: ArchiveOverview;
	private readonly status: ViewStatus;
	private readonly search: (query: string) => Promise<{ method: "semantic" | "lexical"; hits: Hit[] }>;
	private readonly openEntry: (id: string) => string;
	private readonly done: () => void;
	private readonly requestRender: () => void;
	private readonly height: () => number;

	constructor(
		theme: ViewTheme,
		overview: ArchiveOverview,
		status: ViewStatus,
		search: (query: string) => Promise<{ method: "semantic" | "lexical"; hits: Hit[] }>,
		openEntry: (id: string) => string,
		done: () => void,
		requestRender: () => void,
		height: () => number,
	) {
		this.theme = theme;
		this.overview = overview;
		this.status = status;
		this.search = search;
		this.openEntry = openEntry;
		this.done = done;
		this.requestRender = requestRender;
		this.height = height;
	}

	invalidate(): void {}

	private rows(): Row[] {
		if (this.tab === "prova") return this.results;
		if (this.tab === "voci") {
			return this.overview.entries.map((entry) => ({
				title: `${entry.injected ? "●" : " "} ${entry.id.slice(0, 8)}  ${entry.label.padEnd(12)}  ${String(entry.chars).padStart(6)} car  ${entry.preview}`,
				detail: "",
				open: entry.id,
			}));
		}
		return this.overview.injections.map((injection, i) => ({
			title: `${String(i + 1).padStart(2)}  ${injection.method === "semantic" ? "sem" : "lex"}  ${injection.hits.map((hit) => `#${hit.id}${hit.z !== undefined ? ` z${hit.z.toFixed(1)}` : ""}`).join(" ")}  «${injection.prompt.replace(/\s+/g, " ").slice(0, 70)}»`,
			detail: `Prompt:\n${injection.prompt}\n\nMetodo: ${injection.method === "semantic" ? "semantico (e5)" : "lessicale (BM25)"}\n\n${injection.text}`,
		}));
	}

	private detail(row: Row | undefined): string {
		if (!row) return this.tab === "iniezioni" ? "Nessuna iniezione in questa sessione: nessun prompt ha richiamato qualcosa dall'archivio." : this.tab === "prova" ? "Scrivi una domanda e premi invio: vedi cosa recupererebbe l'archivio e con che z-score." : "";
		if (row.open) {
			if (!this.opened.has(row.open)) this.opened.set(row.open, this.openEntry(row.open));
			return `${row.detail ? `${row.detail}\n\n` : ""}${this.opened.get(row.open)}`;
		}
		return row.detail;
	}

	private async runSearch(): Promise<void> {
		const query = this.query.trim();
		if (!query || this.busy) return;
		this.busy = true;
		this.note = "calcolo…";
		this.requestRender();
		try {
			const { method, hits } = await this.search(query);
			this.results = hits.map((hit) => {
				const z = hit.z;
				const over = z !== undefined && z >= this.status.threshold;
				return {
					title: `${method === "semantic" ? `z ${(z ?? 0).toFixed(1).padStart(4)}` : `BM25 ${hit.score.toFixed(1)}`}  #${hit.entryId.slice(0, 8)}  ${hit.label.padEnd(12)}  ${hit.text.replace(/\s+/g, " ").slice(0, 80)}`,
					detail: hit.text,
					flag: over ? "ok" : undefined,
					open: undefined,
				};
			});
			this.index.set("prova", 0);
			this.scroll = 0;
			this.note = method === "semantic" ? `semantico · soglia z ≥ ${this.status.threshold}: le righe verdi sarebbero state iniettate` : "indice semantico non pronto: ricerca lessicale";
		} catch (error) {
			this.note = `errore: ${(error as Error).message}`;
		} finally {
			this.busy = false;
			this.requestRender();
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) return this.done();
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			const at = TABS.findIndex((entry) => entry.id === this.tab);
			this.tab = TABS[(at + (matchesKey(data, "tab") ? 1 : TABS.length - 1)) % TABS.length].id;
			this.scroll = 0;
			return this.requestRender();
		}
		const count = this.rows().length;
		const move = (delta: number) => {
			this.index.set(this.tab, Math.max(0, Math.min(count - 1, (this.index.get(this.tab) ?? 0) + delta)));
			this.scroll = 0;
			this.requestRender();
		};
		if (matchesKey(data, "up")) return move(-1);
		if (matchesKey(data, "down")) return move(1);
		if (matchesKey(data, "home")) return move(-count);
		if (matchesKey(data, "end")) return move(count);
		if (matchesKey(data, "pageDown")) {
			this.scroll += 8;
			return this.requestRender();
		}
		if (matchesKey(data, "pageUp")) {
			this.scroll = Math.max(0, this.scroll - 8);
			return this.requestRender();
		}
		if (this.tab !== "prova") return;
		if (matchesKey(data, "enter")) return void this.runSearch();
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			return this.requestRender();
		}
		const printable = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " && data !== "\x7f" ? data : undefined);
		if (printable) {
			this.query += printable;
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(20, width - 4);
		const total = Math.max(14, this.height());
		const lines: string[] = [];
		const push = (text = "") => lines.push(`${t.fg("border", "│")} ${truncateToWidth(text, inner, "…")}${" ".repeat(Math.max(0, inner - visibleWidth(truncateToWidth(text, inner, "…"))))} ${t.fg("border", "│")}`);
		const rule = (text: string) => lines.push(t.fg("border", `├${text}${"─".repeat(Math.max(0, width - 2 - visibleWidth(text)))}┤`));
		lines.push(t.fg("border", `╭${"─".repeat(width - 2)}╮`));
		const tabs = TABS.map((entry) => (entry.id === this.tab ? t.fg("accent", t.bold(`[${entry.label}]`)) : t.fg("muted", ` ${entry.label} `))).join(" ");
		push(`${t.fg("accent", t.bold("ARCHIVIO"))}  ${tabs}   ${t.fg("muted", "tab cambia · ↑↓ scorri · pgsu/pggiù dettaglio · esc chiude")}`);
		push(t.fg("dim", `${this.overview.entries.length} voci · ${this.status.chunks} pezzi · indice semantico ${this.status.semantic ? `${this.status.vectors}/${this.status.chunks}` : "non pronto"} · ${this.overview.compactions} compattazioni · ${this.overview.injections.length} iniezioni · soglia z ≥ ${this.status.threshold}`));
		if (this.tab === "prova") {
			rule("");
			push(`${t.fg("accent", "domanda ›")} ${t.fg("text", this.query)}${this.focused ? CURSOR_MARKER : ""}${t.fg("accent", "▏")}   ${t.fg("dim", this.note)}`);
		}
		rule("");
		const rows = this.rows();
		const selected = Math.min(this.index.get(this.tab) ?? 0, Math.max(0, rows.length - 1));
		const listHeight = Math.max(3, Math.floor((total - lines.length - 4) * 0.4));
		const first = Math.max(0, Math.min(selected - Math.floor(listHeight / 2), rows.length - listHeight));
		if (rows.length === 0) push(t.fg("dim", this.tab === "prova" ? "(nessun risultato ancora)" : this.tab === "iniezioni" ? "(nessuna iniezione)" : "(vuoto)"));
		for (let i = first; i < Math.min(rows.length, first + listHeight); i++) {
			const on = i === selected;
			const color = rows[i].flag === "ok" ? "success" : on ? "accent" : "text";
			push(`${on ? t.fg("accent", "›") : " "} ${t.fg(color, rows[i].title)}`);
		}
		rule(` ${rows.length ? `${selected + 1}/${rows.length}` : ""} `);
		const body = this.detail(rows[selected]).split("\n").flatMap((line) => wrapTextWithAnsi(line, inner));
		const room = Math.max(2, total - lines.length - 1);
		this.scroll = Math.min(this.scroll, Math.max(0, body.length - room));
		for (const line of body.slice(this.scroll, this.scroll + room)) push(t.fg("text", line));
		while (lines.length < total - 1) push();
		lines.push(t.fg("border", `╰${"─".repeat(width - 2)}╯`));
		return lines;
	}
}
