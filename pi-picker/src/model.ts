/**
 * Picker state without rendering: location, query, cursor, hidden items and multi-selection.
 */
import { fuzzyFilter } from "@earendil-works/pi-tui";
import type { PickerItem } from "./sources.ts";

export class PickerModel {
	location: string;
	readonly multi: boolean;
	query = "";
	cursor = 0;
	showHidden = false;
	/** Marked items in selection order (multi mode). */
	readonly selected = new Map<string, PickerItem>();
	private entries: PickerItem[] = [];
	private pool: PickerItem[] | undefined;

	constructor(location: string, multi: boolean) {
		this.location = location;
		this.multi = multi;
	}

	setEntries(entries: PickerItem[], pool?: PickerItem[]): void {
		this.entries = entries;
		this.pool = pool;
		this.move(0);
	}

	/** Moves to another location: new items, empty query; the selection survives. */
	setLocation(location: string): void {
		this.location = location;
		this.query = "";
		this.cursor = 0;
		this.entries = [];
		this.pool = undefined;
	}

	visible(): PickerItem[] {
		const shown = (items: PickerItem[]) => (this.showHidden ? items : items.filter((item) => !item.hidden));
		if (this.query === "") return shown(this.entries);
		return fuzzyFilter(shown(this.pool ?? this.entries), this.query, (item) => item.label);
	}

	current(): PickerItem | undefined {
		return this.visible()[this.cursor];
	}

	move(delta: number): void {
		const count = this.visible().length;
		this.cursor = count === 0 ? 0 : Math.min(Math.max(this.cursor + delta, 0), count - 1);
	}

	type(text: string): void {
		this.query += text;
		this.cursor = 0;
	}

	/** Deletes the last query character; true when the query was already empty (go up instead). */
	backspace(): boolean {
		if (this.query === "") return true;
		this.query = this.query.slice(0, -1);
		this.cursor = 0;
		return false;
	}

	/** Marks or unmarks the current item; false when there is nothing to toggle. */
	toggle(): boolean {
		const item = this.current();
		if (!this.multi || !item) return false;
		if (this.selected.has(item.value)) this.selected.delete(item.value);
		else this.selected.set(item.value, item);
		return true;
	}

	toggleHidden(): void {
		this.showHidden = !this.showHidden;
		this.move(0);
	}

	/** Marked values (multi mode) or the current one; undefined when the list is empty. */
	result(): string[] | undefined {
		if (this.multi && this.selected.size > 0) return [...this.selected.keys()];
		const item = this.current();
		return item ? [item.value] : undefined;
	}
}
