/**
 * The picker UI: a bordered box with location, query, item list (with a preview pane on wide terminals) and a
 * key hint footer. Works as a Pi overlay (`ctx.ui.custom`) and in a standalone pi-tui program.
 */
import { type Component, CURSOR_MARKER, decodeKittyPrintable, type Focusable, matchesKey, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { PickerModel } from "./model.ts";
import type { PickerItem, PickerSource } from "./sources.ts";

type PickerColor = "accent" | "border" | "borderAccent" | "muted" | "dim" | "success" | "warning" | "text";

/** The subset of Pi's Theme the picker uses; Pi's theme fits it as is. */
export interface PickerTheme {
	fg(color: PickerColor, text: string): string;
	bold(text: string): string;
}

export interface PickerOptions {
	title: string;
	source: PickerSource;
	/** Space marks several items; Enter returns all marked ones. */
	multi?: boolean;
	/** Preview text for the highlighted item (default: the source's preview). */
	preview?: (item: PickerItem) => string | undefined | Promise<string | undefined>;
	/** List rows (default 12). */
	maxVisible?: number;
	/** The preview is trusted ANSI made by code (e.g. an image thumbnail): keep its colors instead of sanitizing it. */
	rawPreview?: boolean;
}

export const PREVIEW_MIN_WIDTH = 100;
// Rows above the list: top border, location, query, separator.
const LIST_TOP = 4;

const sanitize = (text: string) => text.replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const pad = (text: string, width: number) => truncateToWidth(text, width, "…", true);

export class PickerComponent implements Component, Focusable {
	focused = false;
	private readonly model: PickerModel;
	private readonly maxVisible: number;
	private scroll = 0;
	private loading: Promise<void> = Promise.resolve();
	private loaded = false;
	private readonly previews = new Map<string, string | undefined>();
	private readonly options: PickerOptions;
	private readonly theme: PickerTheme;
	private readonly done: (result: string[] | undefined) => void;
	private readonly requestRender: () => void;

	constructor(options: PickerOptions, theme: PickerTheme, done: (result: string[] | undefined) => void, requestRender: () => void) {
		this.options = options;
		this.theme = theme;
		this.done = done;
		this.requestRender = requestRender;
		this.model = new PickerModel(options.source.start, options.multi ?? false);
		this.maxVisible = options.maxVisible ?? 12;
	}

	/** Loads the start location. */
	load(): Promise<void> {
		return this.goTo(this.options.source.start);
	}

	/** Resolves when the current location has loaded. */
	idle(): Promise<void> {
		return this.loading;
	}

	private goTo(location: string): Promise<void> {
		const { source } = this.options;
		this.model.setLocation(location);
		this.loaded = false;
		this.scroll = 0;
		this.loading = (async () => {
			const entries = await source.list(location);
			const pool = source.search ? await source.search(location) : undefined;
			if (this.model.location !== location) return;
			this.model.setEntries(entries, pool);
		})()
			.catch(() => this.model.setEntries([]))
			.finally(() => {
				this.loaded = true;
				this.requestRender();
			});
		return this.loading;
	}

	private goUp(): void {
		const parent = this.options.source.parent?.(this.model.location);
		if (parent !== undefined) void this.goTo(parent);
	}

	private enterCurrent(): void {
		const target = this.model.current()?.enter;
		if (target !== undefined && this.options.source.parent) void this.goTo(target);
	}

	handleInput(data: string): void {
		const { model } = this;
		if (matchesKey(data, "escape")) return this.done(undefined);
		if (matchesKey(data, "enter")) {
			const result = model.result();
			if (result) this.done(result);
			return;
		}
		if (matchesKey(data, "up")) model.move(-1);
		else if (matchesKey(data, "down")) model.move(1);
		else if (matchesKey(data, "pageUp")) model.move(-this.maxVisible);
		else if (matchesKey(data, "pageDown")) model.move(this.maxVisible);
		else if (matchesKey(data, "tab") || matchesKey(data, "right")) this.enterCurrent();
		else if (matchesKey(data, "left")) this.goUp();
		else if (matchesKey(data, "backspace")) {
			if (model.backspace()) this.goUp();
		} else if (matchesKey(data, "alt+h")) model.toggleHidden();
		else if (matchesKey(data, "space") && model.multi) model.toggle();
		else {
			const char = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " && data !== "\x7f" ? data : undefined);
			if (char === undefined) return;
			model.type(char);
		}
		this.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.model.move(event.wheelDelta < 0 ? -1 : 1);
		} else if (event.type === "click" && event.button === "left") {
			const row = event.y - LIST_TOP;
			const index = this.scroll + row;
			if (row < 0 || row >= this.maxVisible || index >= this.model.visible().length) return undefined;
			this.model.move(index - this.model.cursor);
			if (this.model.multi) this.model.toggle();
			else {
				const result = this.model.result();
				if (result) this.done(result);
				return { handled: true };
			}
		} else return undefined;
		this.requestRender();
		return { handled: true };
	}

	invalidate(): void {
		this.previews.clear();
	}

	private previewOf(item: PickerItem): string | undefined {
		if (this.previews.has(item.value)) return this.previews.get(item.value);
		const provider = this.options.preview ?? this.options.source.preview;
		if (!provider) return undefined;
		const text = provider(item);
		if (text instanceof Promise) {
			this.previews.set(item.value, "…");
			void text.then((resolved) => {
				this.previews.set(item.value, resolved);
				this.requestRender();
			}, () => this.previews.set(item.value, undefined));
			return "…";
		}
		this.previews.set(item.value, text);
		return text;
	}

	render(width: number): string[] {
		const { theme, model } = this;
		const inner = Math.max(width - 4, 10);
		const border = (text: string) => theme.fg("borderAccent", text);
		const row = (text: string) => `${border("│")} ${pad(text, inner)} ${border("│")}`;
		const line = (left: string, right: string) => border(`${left}${"─".repeat(inner + 2)}${right}`);

		const title = ` ${theme.bold(this.options.title)} `;
		const top = border("╭─") + title + border(`${"─".repeat(Math.max(inner + 1 - visibleWidth(title), 0))}╮`);
		const location = this.options.source.describe?.(model.location) ?? model.location;
		const query = `${theme.fg("accent", "›")} ${model.query}${this.focused ? CURSOR_MARKER : ""}${theme.fg("dim", "▏")}`;

		const items = model.visible();
		if (model.cursor < this.scroll) this.scroll = model.cursor;
		if (model.cursor >= this.scroll + this.maxVisible) this.scroll = model.cursor - this.maxVisible + 1;
		this.scroll = Math.min(this.scroll, Math.max(items.length - this.maxVisible, 0));

		const withPreview = width >= PREVIEW_MIN_WIDTH && (this.options.preview ?? this.options.source.preview) !== undefined;
		const listWidth = withPreview ? Math.floor((inner - 3) * 0.6) : inner;
		const previewWidth = inner - listWidth - 3;
		const current = model.current();
		const rawPreview = this.options.rawPreview === true;
		const previewText = withPreview && current ? (this.previewOf(current) ?? "") : "";
		const previewLines = previewText ? (rawPreview ? previewText : sanitize(previewText)).split("\n") : [];

		const body: string[] = [];
		for (let index = 0; index < this.maxVisible; index++) {
			const item = items[this.scroll + index];
			let text = "";
			if (item) text = this.itemText(item, item === current, listWidth);
			else if (index === 0) text = theme.fg("muted", this.loaded ? (model.query ? "nessun risultato" : "(vuoto)") : "caricamento…");
			const preview = truncateToWidth(previewLines[index] ?? "", previewWidth, "");
			body.push(row(withPreview ? `${pad(text, listWidth)} ${border("│")} ${rawPreview ? pad(preview, previewWidth) : theme.fg("muted", pad(preview, previewWidth))}` : text));
		}

		const count = items.length === 0 ? "0" : `${model.cursor + 1}/${items.length}`;
		const marked = model.selected.size > 0 ? ` · ${model.selected.size} selezionati` : "";
		const keys = ["Esc annulla", "Invio conferma", ...(model.multi ? ["Spazio segna"] : []), ...(this.options.source.parent ? ["Tab entra", "← su"] : []), "Alt+H nascosti"];
		const footer = `${theme.fg("accent", count + marked)}  ${theme.fg("dim", keys.join(" · "))}`;

		return [top, row(theme.fg("muted", location)), row(query), line("├", "┤"), ...body, line("├", "┤"), row(footer), line("╰", "╯")];
	}

	private itemText(item: PickerItem, isCurrent: boolean, width: number): string {
		const { theme, model } = this;
		const pointer = isCurrent ? theme.fg("accent", "› ") : "  ";
		const mark = model.multi ? (model.selected.has(item.value) ? theme.fg("success", "◉ ") : theme.fg("dim", "○ ")) : "";
		const label = item.enter !== undefined ? theme.fg("accent", item.label) : item.label;
		const description = item.description ? `  ${theme.fg("dim", item.description)}` : "";
		const text = `${pointer}${mark}${isCurrent ? theme.bold(label) : label}${description}`;
		return truncateToWidth(text, width, "…");
	}
}
