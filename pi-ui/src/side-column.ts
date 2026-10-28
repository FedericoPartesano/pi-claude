/**
 * A column of Pi's layout any extension can fill with its own component: it takes the place of the session panel
 * while open, so the chat gets narrower and nothing is covered. Extensions find it through a shared object on a global
 * symbol (the packages do not import each other); where no column is available (regular mode, terminal too narrow)
 * they fall back to their own overlay. Opening it does NOT take the keyboard: the chat keeps working. The component
 * gets the keys after a click on it, and `blur` (or closing the column) gives them back to what had them.
 */
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { FocusHost } from "./browser-column.ts";

export const SIDE_COLUMN: unique symbol = Symbol.for("pi-claude/side-column") as never;

export interface SideColumnApi {
	/** Can a column be shown now (layout root in place, wide enough)? */
	available(): boolean;
	isOpen(): boolean;
	/** Shows `component` in the column, the keyboard stays where it was; `onClose` runs when the column closes. */
	open(component: Component, options?: { width?: number; onClose?: () => void }): void;
	close(): void;
	/** Moves the keyboard into the column (the key chord of the extension that fills it, or a click on it). */
	focus(): void;
	isFocused(): boolean;
	/** Gives the keyboard back to what had it before the column took it. */
	blur(): void;
	redraw(): void;
}

export class SideColumn implements Component {
	active = false;
	width = 56;
	private component?: Component;
	private previous: Component | null = null;
	private onClose?: () => void;
	private readonly host: () => FocusHost | undefined;
	private readonly redraw: () => void;

	constructor(redraw: () => void, host: () => FocusHost | undefined = () => undefined) {
		this.redraw = redraw;
		this.host = host;
	}

	open(component: Component, options: { width?: number; onClose?: () => void } = {}): void {
		this.component = component;
		this.width = options.width ?? 56;
		this.onClose = options.onClose;
		this.active = true;
		this.redraw();
	}

	focus(): void {
		if (!this.active) return;
		const host = this.host();
		const current = host?.getFocusedComponent() ?? null;
		if (current === this) return;
		this.previous = current;
		host?.setFocus(this);
		this.redraw();
	}

	isFocused(): boolean {
		return this.host()?.getFocusedComponent() === this;
	}

	blur(): void {
		const host = this.host();
		if (host?.getFocusedComponent() === this) {
			host.setFocus(this.previous);
			this.redraw();
		}
	}

	close(): void {
		if (!this.active) return;
		this.active = false;
		const onClose = this.onClose;
		this.component = undefined;
		this.onClose = undefined;
		this.blur();
		this.previous = null;
		onClose?.();
		this.redraw();
	}

	handleInput(data: string): void {
		this.component?.handleInput?.(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const result = this.component?.handleMouse?.(event);
		if (!result) return undefined;
		if (result.focus) {
			const host = this.host();
			const current = host?.getFocusedComponent() ?? null;
			if (current !== this) this.previous = current;
		}
		return result;
	}

	invalidate(): void {
		this.component?.invalidate();
	}

	render(width: number): string[] {
		return this.component?.render(width) ?? [];
	}
}

export function publishSideColumn(api: SideColumnApi | undefined): void {
	(globalThis as unknown as Record<symbol, SideColumnApi | undefined>)[SIDE_COLUMN] = api;
}
