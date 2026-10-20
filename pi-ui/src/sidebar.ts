/**
 * The pinned session panel as a real side column in Pi's fullscreen mode: the layout root becomes an hstack with the
 * chat (growing) and the panel (fixed width), laid out by Pi's own layout engine, so scrolling, mouse and selection
 * keep working and nothing is covered. Only from 120 terminal columns; narrower, the panel is a toggled overlay.
 */
import type { Component } from "@earendil-works/pi-tui";

export const PINNED_MIN_COLUMNS = 120;
/** Pi's layout protocol: a global symbol, the same in Pi's bundle and in this package's copy of pi-tui. */
export const LAYOUT_NODE: unique symbol = Symbol.for("@earendil-works/pi-tui/layout-node") as never;

/** Columns kept for the panel (its width plus a gap), 0 when it is not pinned or the terminal is too narrow. */
export function sidebarWidth(termWidth: number, pinned: boolean, panelWidth: number): number {
	return pinned && termWidth >= PINNED_MIN_COLUMNS ? panelWidth + 1 : 0;
}

export interface SidebarRoot extends Component {
	[LAYOUT_NODE](): {
		type: "hstack";
		gap: number;
		align: "stretch";
		entries: { component: Component; grow?: number; shrink?: number; basis?: number; visible?: (viewport: { width: number; height: number }) => boolean }[];
	};
	/** The layout root it wraps (Pi's own). */
	inner: Component;
}

/** An optional column between the chat and the panel (the browser): fixed width, shown while `visible()` is true. */
export interface ExtraColumn {
	component: Component;
	width: (termWidth: number) => number;
	visible: () => boolean;
}

export function sidebarRoot(inner: Component, panel: Component, width: number, extra?: ExtraColumn, panelVisible: () => boolean = () => true): SidebarRoot {
	return {
		inner,
		[LAYOUT_NODE]: () => ({
			type: "hstack",
			gap: 0,
			align: "stretch",
			entries: [
				// basis 0 + grow: the chat takes the rest without being measured at full width first (measuring it at another
				// width than it is drawn at defeated Pi's Markdown cache: ~84 ms per keystroke instead of ~7 on a long session).
				{ component: inner, basis: 0, grow: 1, shrink: 1 },
				...(extra ? [{ component: extra.component, basis: extra.width(process.stdout.columns ?? 0), shrink: 0, visible: (viewport: { width: number; height: number }) => extra.visible() && viewport.width >= PINNED_MIN_COLUMNS }] : []),
				{ component: panel, basis: width, shrink: 0, visible: (viewport) => panelVisible() && viewport.width >= PINNED_MIN_COLUMNS },
			],
		}),
		// Outside the layout engine (e.g. the transcript printed on exit) only the chat.
		render: (columns) => inner.render(columns),
		invalidate: () => inner.invalidate(),
	};
}
