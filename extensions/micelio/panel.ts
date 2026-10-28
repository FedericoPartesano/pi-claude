/**
 * The panel glue: the only file of the extension that imports pi-tui, loaded on demand (pi-tui exists only inside Pi),
 * the way browser/liveview.ts is.
 */
import { matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Paint } from "./memories.ts";
import { PanelView, type PanelData } from "./panel-view.ts";

export const PANEL_WIDTH = 56;

type SideColumnApi = { available(): boolean; open(component: unknown, options?: { width?: number; onClose?: () => void }): void; close(): void; focus(): void; isFocused(): boolean; blur(): void; redraw(): void };
/** pi-ui's layout column (src/side-column.ts), found through a global symbol: the two packages do not import each other. */
const sideColumn = (): SideColumnApi | undefined => (globalThis as unknown as Record<symbol, SideColumnApi | undefined>)[Symbol.for("pi-claude/side-column")];

const TYPE_COLORS: Record<string, "accent" | "warning" | "success" | "error" | "muted"> = { fact: "accent", gotcha: "warning", decision: "accent", reference: "muted", howto: "success" };

/** What the extension can do to the open panel from outside: close it, move the keyboard in and out, redraw. */
export type Handle = { close: () => void; redraw: () => void; focus: () => void; blur: () => void; isFocused: () => boolean };

function styleOf(theme: ExtensionContext["ui"]["theme"]): { paint: Paint; text: { name: (text: string) => string; dim: (text: string) => string } } {
	return {
		paint: {
			key: (text) => `\x1b[7m${theme.bold(theme.fg("accent", text))}\x1b[27m`,
			// A filled label: the colour of the type as background (reverse video), the bold text in the terminal's own.
			chip: (type, text) => `\x1b[7m${theme.bold(theme.fg(TYPE_COLORS[type] ?? "muted", text))}\x1b[27m`,
			title: (text) => theme.bold(text),
			dim: (text) => theme.fg("dim", text),
			frame: (text, isSelected) => theme.fg(isSelected ? "accent" : "borderMuted", text),
		},
		text: { name: (text) => theme.bold(theme.fg("accent", text)), dim: (text) => theme.fg("dim", text) },
	};
}

/**
 * Shows the panel and settles when it is closed. In fullscreen on a wide terminal it is a column of pi-ui's layout, in
 * place of the session panel (the chat gets narrower, nothing is covered); otherwise an overlay on the right.
 * `onOpen` receives how to close and redraw it from outside.
 */
export async function openMicelioPanel(ctx: ExtensionContext, read: () => PanelData, key: string, focusKey: string, onOpen: (handle: Handle) => void): Promise<void> {
	const column = sideColumn();
	if (column?.available()) {
		await new Promise<void>((resolve) => {
			const { paint, text } = styleOf(ctx.ui.theme);
			const view = new PanelView({ read, paint, text, matches: (data, name) => matchesKey(data, name as never), key, focusKey, focused: () => column.isFocused(), rows: () => (process.stdout.rows ?? 30) - 1, blur: () => column.blur(), done: () => column.close(), requestRender: () => column.redraw() });
			onOpen({ close: () => column.close(), redraw: () => column.redraw(), focus: () => column.focus(), blur: () => column.blur(), isFocused: () => column.isFocused() });
			column.open(view, { width: PANEL_WIDTH, onClose: resolve });
		});
		return;
	}
	let overlay: { focus(): void; unfocus(): void; isFocused(): boolean } | undefined;
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const { paint, text } = styleOf(theme);
			onOpen({ close: () => done(), redraw: () => tui.requestRender(), focus: () => overlay?.focus(), blur: () => overlay?.unfocus(), isFocused: () => Boolean(overlay?.isFocused()) });
			return new PanelView({ read, paint, text, matches: (data, name) => matchesKey(data, name as never), key, focusKey, focused: () => Boolean(overlay?.isFocused()), rows: () => (process.stdout.rows ?? 30) - 2, blur: () => overlay?.unfocus(), done: () => done(), requestRender: () => tui.requestRender() });
		},
		{ overlay: true, onHandle: (handle) => (overlay = handle), overlayOptions: { nonCapturing: true, anchor: "top-right", width: PANEL_WIDTH, maxHeight: "100%", margin: { top: 0, right: 0 }, visible: (width) => width >= 80 } },
	);
}
