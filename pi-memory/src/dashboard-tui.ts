/**
 * /memory: full-screen memory dashboard drawn as a modal over the chat. Four views:
 * - Ricordi: every memory by type, with search and filters, details, and actions (pin, edit, supersede, delete).
 * - Cronologia: days when something entered the memory, with a bar per day, the /dream runs and what they saved.
 * - Richiami: which memories were added to which requests, with scores, and the most recalled ones.
 * - Chiedi: a question to the memory: local matches at once (no tokens), then an answer from the model.
 * Colors come from Pi's theme roles, so the dashboard follows /theme.
 */
import { CURSOR_MARKER, decodeKittyPrintable, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import type { MemoryAction } from "./dashboard.ts";
import { recallStats, type DreamRun, type MemoryDashboardSource, type RecallEvent, type SearchHit } from "./dashboard-data.ts";
import type { MemoryRecord } from "./store.ts";
import { strength } from "./strength.ts";

export type ThemeRole = "accent" | "muted" | "dim" | "text" | "success" | "warning" | "error" | "border" | "borderAccent";
export type ThemeBg = "selectedBg" | "customMessageBg" | "userMessageBg";
export interface DashboardTheme {
	fg(role: ThemeRole, text: string): string;
	bg(role: ThemeBg, text: string): string;
	bold(text: string): string;
}

/** Icon and color of each memory type, used in lists, headers and chips. */
const TYPE_STYLE: Record<string, { icon: string; role: ThemeRole }> = {
	correzione: { icon: "✗", role: "error" },
	preferenza: { icon: "★", role: "accent" },
	decisione: { icon: "◆", role: "warning" },
	fatto: { icon: "●", role: "success" },
	episodio: { icon: "◷", role: "muted" },
};
const typeStyle = (type: string) => TYPE_STYLE[type] ?? { icon: "•", role: "text" as ThemeRole };
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const longDay = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""} ${date.slice(0, 4)}`;

export type View = "ricordi" | "cronologia" | "richiami" | "chiedi";
const VIEWS: { id: View; label: string }[] = [
	{ id: "ricordi", label: "Ricordi" },
	{ id: "cronologia", label: "Cronologia" },
	{ id: "richiami", label: "Richiami" },
	{ id: "chiedi", label: "Chiedi" },
];
const TYPES = ["correzione", "preferenza", "decisione", "fatto", "episodio"];
const TYPE_TITLES: Record<string, string> = { correzione: "CORREZIONI", preferenza: "PREFERENZE", decisione: "DECISIONI", fatto: "FATTI", episodio: "EPISODI" };
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** What the dashboard asks its opener to do after closing: nothing, or open the editor on a memory. */
export type DashboardResult = { edit: { id: string; text: string }; view: View } | undefined;

type Row = { kind: "header"; key?: string; text: string } | { kind: "item"; key: string; text: string };

const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
const fit = (text: string, width: number) => pad(truncateToWidth(text, width), width);
const day = (iso: string) => iso.slice(0, 10);
const shortDay = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export class MemoryDashboard implements Component, Focusable {
	focused = false;
	private view: View;
	private readonly cursors: Record<View, number> = { ricordi: 0, cronologia: 0, richiami: 0, chiedi: 0 };
	private readonly scrolls: Record<View, number> = { ricordi: 0, cronologia: 0, richiami: 0, chiedi: 0 };
	private data: ReturnType<MemoryDashboardSource["load"]>;
	private filter = "";
	private searching = false;
	private typeFilter = 0;
	private scope: "tutti" | "progetto" | "globale" = "tutti";
	private showSuperseded = false;
	private confirmDelete?: string;
	private notice = "";
	private question = "";
	private hits: SearchHit[] = [];
	private hitsFor = "";
	private answer = "";
	private busy: "" | "cerco" | "rispondo" = "";
	private abort?: AbortController;
	private frame = 0;
	private timer?: ReturnType<typeof setInterval>;

	private readonly source: MemoryDashboardSource;
	private readonly theme: DashboardTheme;
	private readonly done: (result: DashboardResult) => void;
	private readonly requestRender: () => void;
	/** Terminal rows available to the dashboard. */
	private readonly rows: () => number;
	private readonly today: string;

	constructor(source: MemoryDashboardSource, theme: DashboardTheme, done: (result: DashboardResult) => void, requestRender: () => void, rows: () => number, today: string, initial: View = "ricordi") {
		this.source = source;
		this.theme = theme;
		this.done = done;
		this.requestRender = requestRender;
		this.rows = rows;
		this.today = today;
		this.view = initial;
		this.data = source.load();
	}

	dispose(): void {
		this.stopSpinner();
		this.abort?.abort();
	}

	invalidate(): void {}

	// ---------------------------------------------------------------- data per view

	private records(): MemoryRecord[] {
		const type = TYPES[this.typeFilter - 1];
		const query = this.filter.toLowerCase();
		return this.data.records.filter((record) =>
			(this.showSuperseded || record.status === "active") &&
			(!type || record.type === type) &&
			(this.scope === "tutti" || (this.scope === "globale") === record.id.startsWith("g:")) &&
			(!query || `${record.text} ${record.type} ${record.entities.join(" ")}`.toLowerCase().includes(query)));
	}

	/** Days with memories created or /dream runs, newest first. */
	private days(): { date: string; created: MemoryRecord[]; runs: DreamRun[] }[] {
		const days = new Map<string, { date: string; created: MemoryRecord[]; runs: DreamRun[] }>();
		const at = (date: string) => days.get(date) ?? days.set(date, { date, created: [], runs: [] }).get(date)!;
		for (const record of this.data.records) if (record.created) at(day(record.created)).created.push(record);
		for (const run of this.data.runs) at(run.date || day(run.at)).runs.push(run);
		return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
	}

	private rowsOf(view: View): Row[] {
		if (view === "ricordi") {
			const records = this.records();
			const rows: Row[] = [];
			for (const type of [...TYPES, ...new Set(records.map((record) => record.type).filter((type) => !TYPES.includes(type)))]) {
				const ofType = records
					.filter((record) => record.type === type)
					.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.status !== "active") - Number(b.status !== "active") || strength(b, this.today) - strength(a, this.today));
				if (ofType.length === 0) continue;
				rows.push({ kind: "header", key: type, text: `${TYPE_TITLES[type] ?? type.toUpperCase()} · ${ofType.length}` });
				for (const record of ofType) rows.push({ kind: "item", key: record.id, text: `${record.pinned ? "📌 " : record.status !== "active" ? "~ " : ""}${record.text}${record.id.startsWith("g:") ? " · globale" : ""}` });
			}
			return rows;
		}
		if (view === "cronologia") {
			const days = this.days();
			const max = Math.max(1, ...days.map((entry) => entry.created.length));
			return days.map((entry) => {
				const bar = "█".repeat(Math.max(entry.created.length ? 1 : 0, Math.round((entry.created.length / max) * 10)));
				const dreams = entry.runs.length ? ` · /dream ×${entry.runs.length}` : "";
				return { kind: "item" as const, key: entry.date, text: `${shortDay(entry.date)}  ${pad(bar, 10)} ${String(entry.created.length).padStart(2)}${dreams}` };
			});
		}
		if (view === "richiami") {
			return this.data.events.map((event, index) => ({ kind: "item" as const, key: String(index), text: `${event.at.slice(11, 16)} ${String(event.hits.length).padStart(2)} ◇ ${event.query.replace(/\s+/g, " ")}` }));
		}
		return this.hits.map((hit, index) => ({ kind: "item" as const, key: String(index), text: hit.record.text }));
	}

	private items(view: View): string[] {
		return this.rowsOf(view).flatMap((row) => (row.kind === "item" ? [row.key] : []));
	}

	private selectedKey(view: View = this.view): string | undefined {
		const items = this.items(view);
		return items[Math.min(this.cursors[view], items.length - 1)];
	}

	private recordById(id: string | undefined): MemoryRecord | undefined {
		return this.data.records.find((record) => record.id === id);
	}

	// ---------------------------------------------------------------- input

	handleInput(data: string): void {
		const printable = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " && data !== "\x7f" ? data : undefined);
		this.notice = "";

		if (this.confirmDelete) {
			const id = this.confirmDelete;
			this.confirmDelete = undefined;
			if (printable === "d") void this.act(id, { kind: "delete" }, "eliminato");
			else this.notice = "eliminazione annullata";
			return this.requestRender();
		}
		if (matchesKey(data, "escape")) {
			if (this.searching) this.searching = false;
			else if (this.busy === "rispondo") this.abort?.abort();
			else return this.done(undefined);
			return this.requestRender();
		}
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			const index = VIEWS.findIndex((entry) => entry.id === this.view);
			this.view = VIEWS[(index + (matchesKey(data, "tab") ? 1 : VIEWS.length - 1)) % VIEWS.length].id;
			this.searching = false;
			return this.requestRender();
		}
		if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
			const step = matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : matchesKey(data, "pageUp") ? -10 : 10;
			const count = this.items(this.view).length;
			this.cursors[this.view] = Math.max(0, Math.min(count - 1, this.cursors[this.view] + step));
			if (this.view === "chiedi") this.answer = this.answer && this.busy !== "rispondo" ? this.answer : "";
			return this.requestRender();
		}

		if (this.view === "chiedi") return this.askInput(data, printable);

		if (this.searching) {
			if (matchesKey(data, "enter")) this.searching = false;
			else if (matchesKey(data, "backspace")) this.filter = this.filter.slice(0, -1);
			else if (printable) this.filter += printable;
			this.cursors.ricordi = 0;
			return this.requestRender();
		}
		const digit = printable && /^[1-4]$/.test(printable) ? Number(printable) : 0;
		if (digit) {
			this.view = VIEWS[digit - 1].id;
			return this.requestRender();
		}
		if (this.view !== "ricordi") return;
		const record = this.recordById(this.selectedKey());
		switch (printable) {
			case "/":
				this.searching = true;
				break;
			case "t":
				this.typeFilter = (this.typeFilter + 1) % (TYPES.length + 1);
				this.cursors.ricordi = 0;
				break;
			case "s":
				this.showSuperseded = !this.showSuperseded;
				this.cursors.ricordi = 0;
				break;
			case "g":
				this.scope = this.scope === "tutti" ? "progetto" : this.scope === "progetto" ? "globale" : "tutti";
				this.cursors.ricordi = 0;
				break;
			case "p":
				if (record) void this.act(record.id, { kind: "pin" }, record.pinned ? "tolto dai fissati" : "📌 fissato");
				break;
			case "x":
				if (record) void this.act(record.id, { kind: "supersede" }, "segnato come superato");
				break;
			case "d":
				if (record) {
					this.confirmDelete = record.id;
					this.notice = "eliminare? premi d di nuovo per confermare, un altro tasto annulla";
				}
				break;
			case "e":
				if (record) return this.done({ edit: { id: record.id, text: record.text }, view: "ricordi" });
				break;
		}
		this.requestRender();
	}

	private askInput(data: string, printable: string | undefined): void {
		if (matchesKey(data, "enter")) {
			const question = this.question.trim();
			if (!question || this.busy) return;
			if (this.hitsFor !== question) void this.search(question);
			else void this.ask(question);
		} else if (matchesKey(data, "backspace")) {
			this.question = this.question.slice(0, -1);
		} else if (printable) {
			this.question += printable;
		}
		this.requestRender();
	}

	private async act(id: string, action: MemoryAction, done: string): Promise<void> {
		try {
			await this.source.act(id, action);
			this.data = this.source.load();
			this.notice = done;
		} catch (error) {
			this.notice = `errore: ${(error as Error).message}`;
		}
		this.requestRender();
	}

	private async search(question: string): Promise<void> {
		this.busy = "cerco";
		this.answer = "";
		this.startSpinner();
		try {
			this.hits = await this.source.search(question);
			this.hitsFor = question;
			this.cursors.chiedi = 0;
		} finally {
			this.busy = "";
			this.stopSpinner();
			this.requestRender();
		}
	}

	private async ask(question: string): Promise<void> {
		this.busy = "rispondo";
		this.answer = "";
		this.abort = new AbortController();
		this.startSpinner();
		try {
			this.answer = await this.source.answer(question, this.hits, (text) => {
				this.answer = text;
				this.requestRender();
			}, this.abort.signal);
		} catch (error) {
			this.answer = this.abort.signal.aborted ? `${this.answer}\n\n(interrotto)` : `Errore: ${(error as Error).message}`;
		} finally {
			this.busy = "";
			this.stopSpinner();
			this.requestRender();
		}
	}

	private startSpinner(): void {
		this.stopSpinner();
		this.timer = setInterval(() => {
			this.frame++;
			this.requestRender();
		}, 100);
		this.timer.unref?.();
	}

	private stopSpinner(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	// ---------------------------------------------------------------- render

	private keycap(key: string, label: string): string {
		return `${this.theme.bg("customMessageBg", this.theme.bold(this.theme.fg("text", ` ${key} `)))} ${this.theme.fg("muted", label)}`;
	}

	private chip(text: string, role: ThemeRole): string {
		return this.theme.bg("selectedBg", this.theme.bold(this.theme.fg(role, ` ${text} `)));
	}

	/** Section title with a rule to the end of the pane: "DETTAGLI ────────". */
	private rule(title: string, width: number, right = ""): string {
		const head = ` ${this.theme.bold(this.theme.fg("muted", title))} `;
		const tail = right ? ` ${right} ` : "";
		return head + this.theme.fg("border", "─".repeat(Math.max(1, width - visibleWidth(head) - visibleWidth(tail) - 1))) + tail;
	}

	private scoreBar(score: number, cells = 8): string {
		const filled = Math.max(0, Math.min(cells, Math.round(score * cells)));
		return this.theme.fg("accent", "▰".repeat(filled)) + this.theme.fg("dim", "▱".repeat(cells - filled));
	}

	private wrap(text: string, width: number, role: ThemeRole = "text", prefix = " "): string[] {
		return wrapTextWithAnsi(text, Math.max(10, width - visibleWidth(prefix) - 1)).map((line) => `${prefix}${this.theme.fg(role, line)}`);
	}

	render(width: number): string[] {
		const t = this.theme;
		const height = Math.max(18, this.rows());
		const inner = Math.max(40, width - 2);
		const leftWidth = Math.max(24, Math.floor(inner * 0.42));
		const rightWidth = inner - leftWidth - 1;
		const border = (text: string) => t.fg("borderAccent", text);
		const row = (text: string) => `${border("│")}${fit(text, inner)}${border("│")}`;
		const split = (left: string, right: string) => {
			const gap = inner - visibleWidth(left) - visibleWidth(right);
			return row(gap > 0 ? left + " ".repeat(gap) + right : left);
		};

		const active = this.data.records.filter((record) => record.status === "active");
		const pinned = active.filter((record) => record.pinned).length;
		const global = active.filter((record) => record.id.startsWith("g:")).length;
		const stats = recallStats(this.data.events, this.data.records, this.today);

		const lines = [border(`╭${"─".repeat(inner)}╮`)];
		lines.push(split(` ${t.bg("selectedBg", t.bold(t.fg("accent", " ◆ MEMORIA ")))} ${t.fg("muted", this.data.where)}`, `${this.keycap("esc", "chiudi")} `));

		// Key figures as cards: label above, value below.
		const cards: [string, string, ThemeRole][] = [
			["ATTIVI", String(active.length), "text"],
			["FISSATI", `${pinned} 📌`, "accent"],
			["SUPERATI", String(this.data.records.length - active.length), "muted"],
			["PROGETTO/GLOBALE", `${active.length - global} · ${global}`, "text"],
			["ULTIMO /DREAM", this.data.lastDream ? shortDay(this.data.lastDream) : "mai", this.data.lastDream ? "text" : "warning"],
			["RICHIAMI OGGI", String(stats.today), "success"],
		];
		const shown = cards.slice(0, inner >= 110 ? 6 : inner >= 80 ? 5 : 4);
		const cardWidth = Math.floor((inner - 1) / shown.length);
		// Two columns of gap between cards, whatever the label length.
		lines.push(row(` ${shown.map(([name]) => fit(t.fg("dim", name), cardWidth - 2) + "  ").join("")}`));
		lines.push(row(` ${shown.map(([, value, role]) => fit(t.bold(t.fg(role, value)), cardWidth - 2) + "  ").join("")}`));

		// Tab bar with counts; the active tab is highlighted and underlined.
		const counts = [this.records().length, this.days().length, this.data.events.length, this.hitsFor ? this.hits.length : undefined];
		let tabs = " ";
		let underline = " ";
		VIEWS.forEach((entry, index) => {
			const label = ` ${index + 1} ${entry.label}${counts[index] !== undefined ? ` ${counts[index]}` : ""} `;
			const isActive = entry.id === this.view;
			tabs += `${isActive ? t.bg("selectedBg", t.bold(t.fg("accent", label))) : t.fg("muted", label)} `;
			underline += `${isActive ? t.fg("accent", "━".repeat(visibleWidth(label))) : t.fg("border", "─".repeat(visibleWidth(label)))}${t.fg("border", "─")}`;
		});
		lines.push(split(tabs, `${t.fg("dim", "tab / 1-4 cambia vista")} `));
		lines.push(row(underline + t.fg("border", "─".repeat(Math.max(0, inner - visibleWidth(underline))))));

		const body = height - lines.length - 3;
		const left = this.renderLeft(leftWidth, body);
		const right = this.renderRight(rightWidth, body, stats);
		for (let index = 0; index < body; index++) lines.push(`${border("│")}${left[index] ?? " ".repeat(leftWidth)}${border("│")}${fit(right[index] ?? "", rightWidth)}${border("│")}`);
		lines.push(border(`├${"─".repeat(leftWidth)}┴${"─".repeat(rightWidth)}┤`));
		lines.push(row(` ${this.notice ? `${t.fg("warning", "●")} ${t.fg("warning", this.notice)}` : this.keys()}`));
		lines.push(border(`╰${"─".repeat(inner)}╯`));
		return lines;
	}

	private keys(): string {
		const k = (key: string, label: string) => this.keycap(key, label);
		switch (this.view) {
			case "ricordi":
				return this.searching
					? [k("scrivi", "filtra"), k("invio", "conferma"), k("esc", "smetti")].join("  ")
					: [k("↑↓", "scorri"), k("/", "cerca"), k("t", "tipo"), k("s", "superati"), k("g", "ambito"), k("p", "fissa"), k("e", "modifica"), k("x", "superato"), k("d", "elimina")].join("  ");
			case "cronologia":
				return [k("↑↓", "giorno"), this.theme.fg("dim", "a destra: cosa è entrato in memoria e i /dream di quel giorno")].join("  ");
			case "richiami":
				return [k("↑↓", "richiesta"), this.theme.fg("dim", "a destra: i ricordi aggiunti al contesto, con il punteggio")].join("  ");
			case "chiedi":
				return this.hitsFor && this.hitsFor === this.question.trim()
					? [k("invio", "risposta del modello (pochi token)"), k("↑↓", "ricordi trovati"), k("esc", this.busy ? "interrompi" : "chiudi")].join("  ")
					: [k("scrivi", "una domanda"), k("invio", "cerca nei ricordi (nessun token)")].join("  ");
		}
	}

	/** Left pane: the view's list, each line exactly `width` wide, with the selection highlighted and a scrollbar. */
	private renderLeft(width: number, height: number): string[] {
		const t = this.theme;
		const top: string[] = [];
		const listWidth = width - 1;
		if (this.view === "ricordi") {
			const filters = [
				this.searching || this.filter ? `${t.fg("accent", "⌕")} ${t.fg("text", this.filter)}${this.searching ? `${CURSOR_MARKER}${t.fg("accent", "▏")}` : ""}` : "",
				this.typeFilter ? this.chip(TYPES[this.typeFilter - 1], typeStyle(TYPES[this.typeFilter - 1]).role) : "",
				this.scope !== "tutti" ? this.chip(this.scope, "accent") : "",
				this.showSuperseded ? this.chip("+ superati", "muted") : "",
			].filter(Boolean);
			top.push(` ${filters.length ? filters.join(" ") : t.fg("dim", "tutti i ricordi attivi · / per cercare")}`, "");
		} else if (this.view === "chiedi") {
			const spin = this.busy ? t.fg("accent", SPINNER[this.frame % SPINNER.length]) : t.fg("accent", "❯");
			top.push(` ${t.fg("border", `╭${"─".repeat(listWidth - 3)}╮`)}`);
			top.push(` ${t.fg("border", "│")}${fit(` ${spin} ${t.fg("text", this.question)}${this.focused ? CURSOR_MARKER : ""}${t.fg("accent", "▏")}`, listWidth - 3)}${t.fg("border", "│")}`);
			top.push(` ${t.fg("border", `╰${"─".repeat(listWidth - 3)}╯`)}`);
			top.push(t.fg("dim", this.hitsFor ? ` ${plural(this.hits.length, "ricordo pertinente", "ricordi pertinenti")}` : this.busy ? " cerco…" : " es. che regole ho sui test? cosa sai di pnpm?"));
		} else if (this.view === "cronologia") {
			top.push(t.fg("dim", "  GIORNO   NUOVI RICORDI      /DREAM"), "");
		} else {
			top.push(t.fg("dim", "  ORA    RICORDI   RICHIESTA"), "");
		}

		const rows = this.rowsOf(this.view);
		const room = Math.max(1, height - top.length);
		const itemRows = rows.map((entry, index) => (entry.kind === "item" ? index : -1)).filter((index) => index >= 0);
		const cursorRow = itemRows[Math.min(this.cursors[this.view], itemRows.length - 1)] ?? 0;
		let scroll = this.scrolls[this.view];
		if (cursorRow < scroll) scroll = cursorRow;
		if (cursorRow >= scroll + room) scroll = cursorRow - room + 1;
		scroll = Math.max(0, Math.min(scroll, Math.max(0, rows.length - room)));
		this.scrolls[this.view] = scroll;

		const visible = rows.slice(scroll, scroll + room).map((entry, index) => {
			if (entry.kind === "header") {
				const style = typeStyle(entry.key ?? "");
				const head = ` ${t.fg(style.role, style.icon)} ${t.bold(t.fg("muted", entry.text))} `;
				return fit(head + t.fg("border", "─".repeat(Math.max(1, listWidth - visibleWidth(head) - 1))), listWidth);
			}
			const selected = scroll + index === cursorRow;
			const text = this.itemText(entry.key, entry.text);
			return selected ? t.bg("selectedBg", fit(`${t.fg("accent", "▎")}${t.bold(text)}`, listWidth)) : fit(` ${text}`, listWidth);
		});
		if (rows.length === 0) visible.push(fit(t.fg("muted", this.view === "chiedi" ? "" : "  niente da mostrare"), listWidth));

		// Scrollbar in the last column when the list does not fit.
		const thumbSize = rows.length > room ? Math.max(1, Math.round((room / rows.length) * room)) : 0;
		const thumbStart = rows.length > room ? Math.round((scroll / Math.max(1, rows.length - room)) * (room - thumbSize)) : 0;
		const lines = top.map((line) => fit(line, width));
		for (let index = 0; index < room; index++) {
			const bar = thumbSize && index >= thumbStart && index < thumbStart + thumbSize ? t.fg("accent", "▐") : " ";
			lines.push(`${visible[index] ?? " ".repeat(listWidth)}${bar}`);
		}
		return lines;
	}

	/** One list row per view: type icon for memories, aligned columns for days, recalls and answers. */
	private itemText(key: string, text: string): string {
		const t = this.theme;
		if (this.view === "ricordi") {
			const record = this.recordById(key);
			if (!record) return text;
			const style = typeStyle(record.type);
			const body = record.status !== "active" ? t.fg("dim", `~ ${record.text}`) : t.fg("text", record.text);
			return ` ${t.fg(style.role, style.icon)} ${record.pinned ? "📌 " : ""}${body}${record.id.startsWith("g:") ? t.fg("dim", " · globale") : ""}`;
		}
		if (this.view === "cronologia") {
			const entry = this.days().find((candidate) => candidate.date === key);
			if (!entry) return text;
			const max = Math.max(1, ...this.days().map((candidate) => candidate.created.length));
			const filled = entry.created.length ? Math.max(1, Math.round((entry.created.length / max) * 12)) : 0;
			return ` ${t.fg("text", shortDay(entry.date))}   ${t.fg("accent", "█".repeat(filled))}${t.fg("dim", "░".repeat(12 - filled))} ${t.bold(t.fg("text", String(entry.created.length).padStart(2)))}   ${entry.runs.length ? t.fg("accent", `◆ ${entry.runs.length}`) : t.fg("dim", "·")}`;
		}
		if (this.view === "richiami") {
			const event = this.data.events[Number(key)];
			if (!event) return text;
			return ` ${t.fg("muted", event.at.slice(11, 16))}   ${t.fg("accent", `◇ ${event.hits.length}`)}      ${t.fg("text", event.query.replace(/\s+/g, " "))}`;
		}
		const hit = this.hits[Number(key)];
		if (!hit) return text;
		return ` ${t.bold(t.fg("accent", `${String(Math.round(hit.score * 100)).padStart(3)}%`))} ${this.scoreBar(hit.score, 5)} ${hit.record.status !== "active" ? t.fg("dim", `~ ${hit.record.text}`) : t.fg("text", hit.record.text)}`;
	}

	/** Right pane: details of what is selected on the left, in titled sections. */
	private renderRight(width: number, height: number, stats: ReturnType<typeof recallStats>): string[] {
		const t = this.theme;
		const key = this.selectedKey();
		if (this.view === "ricordi") {
			const record = this.recordById(key);
			return record ? this.recordDetail(record, width) : ["", t.fg("muted", "  nessun ricordo con questi filtri")];
		}
		if (this.view === "cronologia") {
			const entry = this.days().find((candidate) => candidate.date === key);
			if (!entry) return ["", t.fg("muted", "  la cronologia si riempie con /dream")];
			const lines = ["", ` ${t.bold(t.fg("accent", longDay(entry.date)))}  ${t.fg("muted", plural(entry.created.length, "ricordo nuovo", "ricordi nuovi"))}`];
			for (const run of entry.runs) {
				const counts = run.counts;
				lines.push("", this.rule(`/DREAM ${run.scope.toUpperCase()}`, width, t.fg("muted", `${run.at.slice(11, 16)}${run.tokens ? ` · ${run.tokens} token` : ""}`)));
				lines.push(` ${[this.chip(`+${counts.added} nuovi`, "success"), this.chip(`↑${counts.reinforced}`, "accent"), this.chip(`⇄${counts.merged}`, "text"), this.chip(`✎${counts.updated}`, "warning"), this.chip(`−${counts.forgotten}`, "error")].join(" ")}`, "");
				for (const line of run.lines) {
					const role: ThemeRole = line.startsWith("+") ? "success" : line.startsWith("−") ? "error" : line.startsWith("✎") ? "warning" : line.startsWith("↑") ? "accent" : "text";
					lines.push(...this.wrap(line, width, role, "   "));
				}
			}
			const unexplained = entry.created.filter((record) => !entry.runs.some((run) => run.lines.some((line) => line.includes(record.text))));
			if (unexplained.length) {
				lines.push("", this.rule("NATI QUEL GIORNO", width));
				for (const record of unexplained) {
					const style = typeStyle(record.type);
					lines.push(...this.wrap(`${t.fg(style.role, style.icon)} ${record.text}`, width, "text", "   "));
				}
			}
			return lines.slice(0, height);
		}
		if (this.view === "richiami") {
			const lines = ["", this.rule("PIÙ RICHIAMATI", width, t.fg("muted", `${stats.today} oggi · ${stats.total} in tutto`))];
			if (stats.top.length) {
				const max = Math.max(...stats.top.map((entry) => entry.count));
				for (const entry of stats.top) lines.push(fit(`   ${t.fg("accent", "█".repeat(Math.max(1, Math.round((entry.count / max) * 10))).padEnd(10))} ${t.bold(t.fg("text", `${entry.count}×`))} ${t.fg("text", entry.record.text)}`, width));
			} else lines.push(t.fg("muted", "   ancora nessun richiamo"));
			const event: RecallEvent | undefined = this.data.events[Number(key)];
			if (!event) return lines;
			lines.push("", this.rule("RICHIESTA", width, t.fg("muted", event.at.replace("T", " ").slice(0, 16))), ...this.wrap(event.query, width, "muted", "   ▌ "), "");
			lines.push(this.rule("RICORDI AGGIUNTI AL CONTESTO", width));
			for (const hit of event.hits) {
				const record = this.recordById(hit.id);
				lines.push(...this.wrap(`${t.bold(t.fg("accent", `${Math.round(hit.score * 100)}%`))} ${this.scoreBar(hit.score, 5)} ${record ? record.text : `${hit.id} (non più in memoria)`}`, width, "text", "   "));
			}
			return lines.slice(0, height);
		}
		// chiedi
		if (this.busy === "rispondo" || this.answer) {
			const head = this.busy === "rispondo" ? `${t.fg("accent", SPINNER[this.frame % SPINNER.length])} ${t.fg("muted", "il modello risponde dai ricordi…")}` : t.fg("muted", `${plural(this.hits.length, "ricordo usato", "ricordi usati")}`);
			// The model answers in markdown: bold and code shown as styles, not as raw ** and backticks.
			const styled = (this.answer || "…").replace(/\*\*(.+?)\*\*/g, (_match, text: string) => t.bold(text)).replace(/`([^`\n]+)`/g, (_match, text: string) => t.fg("accent", text));
			return ["", this.rule("RISPOSTA DAI RICORDI", width, head), "", ...this.wrap(styled, width, "text", "   ")].slice(-height);
		}
		const hit = this.hits[Number(key)];
		if (hit) return this.recordDetail(hit.record, width);
		return ["", t.fg("muted", "  invio cerca nei ricordi, senza token;"), t.fg("muted", "  invio di nuovo chiede al modello una risposta che usa solo quei ricordi")];
	}

	private recordDetail(record: MemoryRecord, width: number): string[] {
		const t = this.theme;
		const style = typeStyle(record.type);
		const recalled = this.data.events.filter((event) => event.hits.some((hit) => hit.id === record.id));
		const fromDream = this.data.runs.find((run) => run.lines.some((line) => line.includes(record.text)));
		const power = strength(record, this.today);
		const field = (name: string, value: string) => `   ${t.fg("muted", pad(name, 13))}${value}`;
		const chips = [
			this.chip(`${style.icon} ${record.type.toUpperCase()}`, style.role),
			record.pinned ? this.chip("📌 FISSATO", "accent") : "",
			record.status === "active" ? this.chip("ATTIVO", "success") : this.chip("SUPERATO", "muted"),
			this.chip(record.id.startsWith("g:") ? "GLOBALE" : "PROGETTO", "text"),
		].filter(Boolean);
		return [
			"",
			` ${chips.join(" ")}`,
			"",
			...this.wrap(record.text, width, record.status === "active" ? "text" : "dim", `   ${t.fg(style.role, "▌")} `),
			"",
			this.rule("DETTAGLI", width),
			field("Forza", `${this.scoreBar(power)} ${t.fg("text", `${Math.round(power * 100)}%`)}`),
			field("Conferme", t.fg("text", plural(record.confirmations, "volta", "volte"))),
			field("Vale", t.fg("text", record.scope === "sempre" ? "sempre, in ogni modifica" : "quando è pertinente")),
			field("Creato", t.fg("text", record.created)),
			field("Confermato", t.fg("text", record.last)),
			field("Origine", t.fg("text", fromDream ? `/dream del ${shortDay(fromDream.date)} · ${fromDream.scope}` : record.source === "migrated" ? "memoria precedente (migrata)" : "/dream")),
			field("Richiamato", t.fg("text", recalled.length ? `${plural(recalled.length, "volta", "volte")} · ultima ${recalled[0].at.replace("T", " ").slice(0, 16)}` : "mai finora")),
			...(record.status !== "active" && record.reason ? [field("Superato", t.fg("dim", record.reason))] : []),
			...(record.entities.length ? [field("Entità", record.entities.map((entity) => this.chip(entity, "accent")).join(" "))] : []),
			field("Id", t.fg("dim", record.id)),
		];
	}
}
