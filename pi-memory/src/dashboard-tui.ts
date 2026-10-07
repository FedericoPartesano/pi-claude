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
export interface DashboardTheme {
	fg(role: ThemeRole, text: string): string;
	bold(text: string): string;
}

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

type Row = { kind: "header"; text: string } | { kind: "item"; key: string; text: string };

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
				rows.push({ kind: "header", text: `${TYPE_TITLES[type] ?? type.toUpperCase()} · ${ofType.length}` });
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

	render(width: number): string[] {
		const t = this.theme;
		const height = Math.max(14, this.rows());
		const inner = Math.max(30, width - 2);
		const leftWidth = Math.max(20, Math.floor(inner * 0.42));
		const rightWidth = inner - leftWidth - 1;
		const body = height - 7;
		const border = (text: string) => t.fg("borderAccent", text);
		const full = (text: string) => `${border("│")}${fit(` ${text}`, inner)}${border("│")}`;

		const active = this.data.records.filter((record) => record.status === "active");
		const pinned = active.filter((record) => record.pinned).length;
		const superseded = this.data.records.length - active.length;
		const global = active.filter((record) => record.id.startsWith("g:")).length;
		const stats = recallStats(this.data.events, this.data.records, this.today);
		const summary = this.data.records.length === 0
			? t.fg("muted", "nessun ricordo · fai /dream per consolidare le sessioni passate")
			: [
					t.fg("text", `${active.length} attivi`),
					t.fg("accent", `${pinned} 📌`),
					t.fg("muted", plural(superseded, "superato", "superati")),
					t.fg("muted", `progetto ${active.length - global} · globale ${global}`),
					t.fg("muted", this.data.lastDream ? `ultimo /dream ${shortDay(this.data.lastDream)}` : "mai fatto /dream"),
					t.fg("muted", `richiami oggi ${stats.today}`),
				].join(t.fg("dim", " · "));
		const tabs = VIEWS.map((entry, index) => (entry.id === this.view ? t.bold(t.fg("accent", `⟦${index + 1} ${entry.label}⟧`)) : t.fg("muted", ` ${index + 1} ${entry.label} `))).join(" ");
		const title = ` ${t.bold(t.fg("accent", "MEMORIA"))} ${t.fg("muted", this.data.where)} `;
		const close = t.fg("muted", " esc chiudi ");
		const top = border("╭─") + title + border("─".repeat(Math.max(0, inner - 1 - visibleWidth(title) - visibleWidth(close)))) + close + border("╮");

		const left = this.renderLeft(leftWidth, body);
		const right = this.renderRight(rightWidth, body, stats);
		const lines = [
			truncateToWidth(top, width),
			full(summary),
			full(`${tabs}   ${t.fg("dim", "tab cambia vista")}`),
			border(`├${"─".repeat(leftWidth)}┬${"─".repeat(rightWidth)}┤`),
		];
		for (let index = 0; index < body; index++) lines.push(`${border("│")}${fit(left[index] ?? "", leftWidth)}${border("│")}${fit(right[index] ?? "", rightWidth)}${border("│")}`);
		lines.push(border(`├${"─".repeat(leftWidth)}┴${"─".repeat(rightWidth)}┤`));
		lines.push(full(this.notice ? t.fg("warning", this.notice) : t.fg("dim", this.keys())));
		lines.push(border(`╰${"─".repeat(inner)}╯`));
		return lines;
	}

	private keys(): string {
		switch (this.view) {
			case "ricordi":
				return this.searching ? "scrivi per filtrare · invio conferma · esc smette" : "↑↓ scorri · / cerca · t tipo · s superati · g progetto/globale · p 📌 · e modifica · x superato · d elimina";
			case "cronologia":
				return "↑↓ scegli il giorno: a destra cosa è entrato in memoria e i /dream di quel giorno";
			case "richiami":
				return "↑↓ scegli una richiesta: a destra i ricordi aggiunti al contesto, con il punteggio";
			case "chiedi":
				return this.hitsFor && this.hitsFor === this.question.trim() ? "invio: risposta del modello basata su questi ricordi (pochi token) · esc interrompe" : "scrivi una domanda · invio: cerca nei ricordi (nessun token)";
		}
	}

	/** Left pane: the view's list, scrolled to keep the cursor visible. */
	private renderLeft(width: number, height: number): string[] {
		const t = this.theme;
		const lines: string[] = [];
		if (this.view === "ricordi") {
			const filters = [
				this.searching || this.filter ? `${t.fg("accent", "/")}${t.fg("text", this.filter)}${this.searching ? CURSOR_MARKER + t.fg("accent", "▏") : ""}` : "",
				this.typeFilter ? t.fg("accent", `tipo: ${TYPES[this.typeFilter - 1]}`) : "",
				this.scope !== "tutti" ? t.fg("accent", this.scope) : "",
				this.showSuperseded ? t.fg("muted", "+ superati") : "",
			].filter(Boolean);
			lines.push(` ${filters.length ? filters.join(t.fg("dim", " · ")) : t.fg("dim", "tutti i ricordi attivi")}`);
		} else if (this.view === "chiedi") {
			const spin = this.busy ? `${t.fg("accent", SPINNER[this.frame % SPINNER.length])} ` : "";
			lines.push(` ${spin}${t.fg("accent", "❯")} ${t.fg("text", this.question)}${this.focused ? CURSOR_MARKER : ""}${t.fg("accent", "▏")}`);
			lines.push(t.fg("dim", this.hitsFor ? ` ${plural(this.hits.length, "ricordo pertinente", "ricordi pertinenti")}` : " es. che regole ho sui test? cosa sai di pnpm?"));
		} else if (this.view === "cronologia") {
			lines.push(t.fg("dim", " giorno   ricordi nuovi"));
		} else {
			lines.push(t.fg("dim", ` ${plural(this.data.events.length, "richiesta", "richieste")} con ricordi richiamati`));
		}
		const rows = this.rowsOf(this.view);
		const room = height - lines.length;
		const itemRows = rows.map((row, index) => (row.kind === "item" ? index : -1)).filter((index) => index >= 0);
		const cursorRow = itemRows[Math.min(this.cursors[this.view], itemRows.length - 1)] ?? 0;
		let scroll = this.scrolls[this.view];
		if (cursorRow < scroll) scroll = cursorRow;
		if (cursorRow >= scroll + room) scroll = cursorRow - room + 1;
		this.scrolls[this.view] = Math.max(0, scroll);
		if (rows.length === 0) lines.push(t.fg("muted", this.view === "chiedi" ? "" : " niente da mostrare"));
		for (const [index, row] of rows.slice(this.scrolls[this.view], this.scrolls[this.view] + room).entries()) {
			const absolute = index + this.scrolls[this.view];
			if (row.kind === "header") {
				lines.push(` ${t.bold(t.fg("muted", row.text))}`);
				continue;
			}
			const selected = absolute === cursorRow;
			let text = row.text;
			if (this.view === "chiedi") {
				const hit = this.hits[Number(row.key)];
				text = `${this.scoreBar(hit.score, 5)} ${hit.record.status !== "active" ? "~ " : ""}${hit.record.text}`;
			}
			lines.push(selected ? `${t.fg("accent", "›")} ${t.bold(t.fg("text", text))}` : `  ${t.fg("text", text)}`);
		}
		return lines;
	}

	private scoreBar(score: number, cells = 8): string {
		const filled = Math.max(0, Math.min(cells, Math.round(score * cells)));
		return this.theme.fg("accent", "▰".repeat(filled)) + this.theme.fg("dim", "▱".repeat(cells - filled));
	}

	private wrap(text: string, width: number, role: ThemeRole = "text"): string[] {
		return wrapTextWithAnsi(text, Math.max(10, width - 2)).map((line) => ` ${this.theme.fg(role, line)}`);
	}

	/** Right pane: details of what is selected on the left. */
	private renderRight(width: number, height: number, stats: ReturnType<typeof recallStats>): string[] {
		const t = this.theme;
		const field = (name: string, value: string) => ` ${t.fg("muted", `${name}:`)} ${t.fg("text", value)}`;
		const key = this.selectedKey();
		if (this.view === "ricordi") {
			const record = this.recordById(key);
			return record ? this.recordDetail(record, width, field) : [t.fg("muted", " nessun ricordo con questi filtri")];
		}
		if (this.view === "cronologia") {
			const entry = this.days().find((candidate) => candidate.date === key);
			if (!entry) return [t.fg("muted", " la cronologia si riempie con /dream")];
			const lines = [` ${t.bold(t.fg("accent", entry.date))} ${t.fg("muted", `· ${plural(entry.created.length, "ricordo nuovo", "ricordi nuovi")}`)}`];
			for (const run of entry.runs) {
				const counts = run.counts;
				lines.push("", ` ${t.bold(t.fg("text", `/dream ${run.scope}`))} ${t.fg("muted", `${run.at.slice(11, 16)}${run.tokens ? ` · ${run.tokens} token` : ""}`)}`);
				lines.push(` ${t.fg("success", `+${counts.added} nuovi`)} ${t.fg("accent", `↑${counts.reinforced} rinforzati`)} ${t.fg("text", `⇄${counts.merged} uniti`)} ${t.fg("warning", `✎${counts.updated} aggiornati`)} ${t.fg("error", `−${counts.forgotten} dimenticati`)}`);
				for (const line of run.lines) {
					const role: ThemeRole = line.startsWith("+") ? "success" : line.startsWith("−") ? "error" : line.startsWith("✎") ? "warning" : "text";
					lines.push(...this.wrap(line, width, role));
				}
			}
			const unexplained = entry.created.filter((record) => !entry.runs.some((run) => run.lines.some((line) => line.includes(record.text))));
			if (unexplained.length) {
				lines.push("", ` ${t.bold(t.fg("text", "nati quel giorno"))}`);
				for (const record of unexplained) lines.push(...this.wrap(`• [${record.type}] ${record.text}`, width));
			}
			return lines.slice(0, height);
		}
		if (this.view === "richiami") {
			const event: RecallEvent | undefined = this.data.events[Number(key)];
			const lines = [field("oggi", `${stats.today} richiami · ${stats.total} in tutto`)];
			if (stats.top.length) {
				lines.push(` ${t.fg("muted", "più richiamati:")}`);
				const max = Math.max(...stats.top.map((entry) => entry.count));
				for (const entry of stats.top) lines.push(` ${t.fg("accent", "█".repeat(Math.max(1, Math.round((entry.count / max) * 8))))} ${t.fg("text", `${entry.count}× ${entry.record.text}`)}`);
			}
			if (!event) return lines;
			lines.push("", field("richiesta", event.at.replace("T", " ").slice(0, 16)), ...this.wrap(event.query, width, "muted"), "");
			for (const hit of event.hits) {
				const record = this.recordById(hit.id);
				lines.push(...this.wrap(`${this.scoreBar(hit.score)} ${record ? record.text : `${hit.id} (non più in memoria)`}`, width));
			}
			return lines.slice(0, height);
		}
		// chiedi
		if (this.busy === "rispondo" || this.answer) {
			const head = this.busy === "rispondo" ? `${t.fg("accent", SPINNER[this.frame % SPINNER.length])} ${t.fg("muted", "il modello risponde dai ricordi…")}` : t.fg("muted", "risposta dai ricordi");
			// The model answers in markdown: bold and code shown as styles, not as raw ** and backticks.
			const styled = (this.answer || "…").replace(/\*\*(.+?)\*\*/g, (_match, text: string) => t.bold(text)).replace(/`([^`\n]+)`/g, (_match, text: string) => t.fg("accent", text));
			return [` ${head}`, "", ...this.wrap(styled, width)].slice(-height);
		}
		const hit = this.hits[Number(key)];
		if (hit) return this.recordDetail(hit.record, width, field);
		return [t.fg("muted", " invio cerca nei ricordi, invio di nuovo chiede la risposta al modello")];
	}

	private recordDetail(record: MemoryRecord, width: number, field: (name: string, value: string) => string): string[] {
		const t = this.theme;
		const recalled = this.data.events.filter((event) => event.hits.some((hit) => hit.id === record.id));
		const fromDream = this.data.runs.find((run) => run.lines.some((line) => line.includes(record.text)));
		const power = strength(record, this.today);
		return [
			...this.wrap(record.text, width),
			"",
			field("tipo", `${record.type}${record.pinned ? " · 📌 fissato (sempre nel contesto)" : ""}`),
			field("stato", record.status === "active" ? "attivo" : `superato${record.reason ? ` · ${record.reason}` : ""}`),
			field("ambito", `${record.id.startsWith("g:") ? "globale" : "progetto"} · ${record.scope === "sempre" ? "vale sempre" : "quando pertinente"}`),
			` ${t.fg("muted", "forza:")} ${this.scoreBar(power)} ${t.fg("text", `${Math.round(power * 100)}% · confermato ${plural(record.confirmations, "volta", "volte")}`)}`,
			field("date", `creato ${record.created} · ultima conferma ${record.last}`),
			field("origine", fromDream ? `/dream del ${fromDream.date} (${fromDream.scope})` : record.source === "migrated" ? "memoria precedente (migrata)" : "/dream"),
			field("richiamato", recalled.length ? `${plural(recalled.length, "volta", "volte")} · ultima ${recalled[0].at.replace("T", " ").slice(0, 16)}` : "mai finora"),
			...(record.entities.length ? [field("entità", record.entities.join(", "))] : []),
			field("id", record.id),
		];
	}
}
