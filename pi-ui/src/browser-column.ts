/**
 * The page Pi drives, as a real column of Pi's layout (between the chat and the session panel): the chat gets narrower,
 * nothing is covered. The browser extension talks to it through a shared object on a global symbol (the two packages
 * do not import each other); when no column is available (no fullscreen layout, terminal too narrow) it falls back to
 * its own overlay.
 */
import { allocateImageId, getCapabilities, Image, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

export const BROWSER_COLUMN: unique symbol = Symbol.for("pi-claude/browser-column") as never;
/** Narrower than this the chat would be squeezed: no column. */
export const BROWSER_MIN_COLUMNS = 150;

export interface BrowserColumnApi {
	/** Can a column be shown now (layout root in place, wide enough, terminal draws images)? */
	available(): boolean;
	open(): void;
	close(): void;
	setFrame(png: string): void;
	setTitle(title: string): void;
	/** What the user does on the column: clicks, wheel and keys, as positions in the frame (0..1) or raw input. */
	onInput(handler: ((input: BrowserInput) => void) | undefined): void;
}

export type BrowserInput = { type: "click"; fx: number; fy: number } | { type: "wheel"; fx: number; fy: number; deltaY: number } | { type: "key"; data: string };

/** The part of the renderer the column needs to hand the keyboard back. */
export interface FocusHost {
	getFocusedComponent(): Component | null;
	setFocus(component: Component | null): void;
}

const plain = { fallbackColor: (text: string) => text };

export class BrowserColumn implements Component {
	active = false;
	private frame?: string;
	private image?: Image;
	private title = "";
	private readonly imageId = allocateImageId();
	private readonly redraw: () => void;

	handler?: (input: BrowserInput) => void;
	/** True while the keys go to the page (after a click on it); Esc gives them back. */
	focused = false;
	private rows = 0;
	private previous: Component | null = null;
	private readonly host: () => FocusHost | undefined;

	constructor(redraw: () => void, host: () => FocusHost | undefined = () => undefined) {
		this.redraw = redraw;
		this.host = host;
	}

	/** Position inside the picture (the first line is the title), as fractions of it; undefined outside. */
	private point(event: TuiMouseEvent): { fx: number; fy: number } | undefined {
		const picture = this.rows;
		if (picture <= 0 || event.y < 1) return undefined;
		const fx = event.x / Math.max(1, event.width - 2);
		const fy = (event.y - 1 + 0.5) / picture;
		return fx > 1 || fy > 1 ? undefined : { fx, fy };
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const at = this.point(event);
		if (!at || !this.handler) return undefined;
		if (event.type === "wheel") {
			this.handler({ type: "wheel", ...at, deltaY: (event.wheelDelta ?? 1) * 60 });
			return { handled: true, render: false };
		}
		if (event.type !== "click" || event.button !== "left") return { handled: true, render: false };
		const host = this.host();
		const current = host?.getFocusedComponent() ?? null;
		if (current !== this) this.previous = current;
		this.handler({ type: "click", ...at });
		return { handled: true, focus: true };
	}

	handleInput(data: string): void {
		if (data === "\x1b") {
			this.host()?.setFocus(this.previous);
			return;
		}
		this.handler?.({ type: "key", data });
	}

	/** Width of the column for a terminal: about 40% of it. */
	static widthFor(termWidth: number): number {
		return Math.max(40, Math.min(90, Math.floor(termWidth * 0.4)));
	}

	setFrame(png: string): void {
		this.frame = png;
		this.image = undefined;
		this.redraw();
	}

	setTitle(title: string): void {
		this.title = title;
		this.redraw();
	}

	invalidate(): void {
		this.image = undefined;
	}

	render(width: number): string[] {
		const note = this.focused ? " · scrivi nella pagina, Esc per tornare a Pi" : "";
		const head = `\x1b[2m ${this.title || "browser"}${note}\x1b[0m`.slice(0, 400);
		if (!this.frame) return [head, "\x1b[2m (in attesa della pagina…)\x1b[0m"];
		this.image ??= new Image(this.frame, "image/png", plain, { maxWidthCells: Math.max(10, width - 2), imageId: this.imageId });
		const picture = this.image.render(width);
		this.rows = picture.length;
		return [head, ...picture];
	}
}

export const canDrawImages = (): boolean => Boolean(getCapabilities().images);

export function shared(): BrowserColumnApi | undefined {
	return (globalThis as unknown as Record<symbol, BrowserColumnApi | undefined>)[BROWSER_COLUMN];
}
export function publish(api: BrowserColumnApi | undefined): void {
	(globalThis as unknown as Record<symbol, BrowserColumnApi | undefined>)[BROWSER_COLUMN] = api;
}
