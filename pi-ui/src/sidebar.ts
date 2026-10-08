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

export function sidebarRoot(inner: Component, panel: Component, width: number): SidebarRoot {
	return {
		inner,
		[LAYOUT_NODE]: () => ({
			type: "hstack",
			gap: 0,
			align: "stretch",
			entries: [
				{ component: inner, grow: 1, shrink: 1 },
				{ component: panel, basis: width, shrink: 0, visible: (viewport) => viewport.width >= PINNED_MIN_COLUMNS },
			],
		}),
		// Outside the layout engine (e.g. the transcript printed on exit) only the chat.
		render: (columns) => inner.render(columns),
		invalidate: () => inner.invalidate(),
	};
}
