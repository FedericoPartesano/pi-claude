/**
 * `pick()`: the one entry point other extensions use. Overlay picker in the TUI, plain select where only dialogs
 * work (RPC), nothing without UI.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { PickerComponent, type PickerOptions } from "./component.ts";

export type { PickerOptions, PickerTheme } from "./component.ts";

export async function pick(ctx: ExtensionContext, options: PickerOptions): Promise<string[] | undefined> {
	if (!ctx.hasUI) return undefined;
	if (ctx.mode !== "tui") return pickWithSelect(ctx, options);
	let host: TUI | undefined;
	const result = await ctx.ui.custom<string[] | undefined>(
		(tui, theme, _keybindings, done) => {
			host = tui;
			const picker = new PickerComponent(options, theme, done, () => tui.requestRender());
			void picker.load();
			return picker;
		},
		{ overlay: true, overlayOptions: { width: "90%", minWidth: 40, maxHeight: "90%", anchor: "center" } },
	);
	// Callers usually change the editor right after (pasteToEditor does not redraw): render once they did.
	const tui = host;
	if (tui) setTimeout(() => tui.requestRender(), 0);
	return result;
}

/** Dialog-only hosts: one level of the source, no navigation or multi-selection. */
async function pickWithSelect(ctx: ExtensionContext, options: PickerOptions): Promise<string[] | undefined> {
	const items = await options.source.list(options.source.start);
	const labels = items.map((item) => (item.description ? `${item.label} — ${item.description}` : item.label));
	const chosen = await ctx.ui.select(options.title, labels);
	const item = chosen === undefined ? undefined : items[labels.indexOf(chosen)];
	return item ? [item.value] : undefined;
}

/** Paths as Pi @mentions, `@"..."` when they contain spaces, with a trailing space to keep typing. */
export function formatMentions(paths: string[]): string {
	if (paths.length === 0) return "";
	return `${paths.map((path) => (/\s/.test(path) ? `@"${path}"` : `@${path}`)).join(" ")} `;
}
