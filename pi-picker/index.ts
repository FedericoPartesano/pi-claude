/**
 * pi-picker: global modal picker for Pi.
 *
 * - Alt+O (or /pick): browse the project and insert one or more @file / @folder/ mentions into the prompt.
 *   Ctrl+O is taken by Pi (expand tool output).
 * - Library for other extensions: `pick(ctx, { title, source, multi, preview })` from `src/pick.ts`, with the
 *   sources in `src/sources.ts` (files, dirs, recent projects, plain lists).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatMentions, pick } from "./src/pick.ts";
import { filesSource } from "./src/sources.ts";

export { formatMentions, pick } from "./src/pick.ts";
export { dirsSource, filesSource, listSource, projectsSource, type PickerItem, type PickerSource } from "./src/sources.ts";

export default function (pi: ExtensionAPI) {
	const insertMentions = async (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return ctx.ui.notify("Il picker dei file funziona solo nella TUI.", "warning");
		const paths = await pick(ctx, { title: "Inserisci file o cartelle", source: filesSource(ctx.cwd), multi: true });
		if (paths?.length) ctx.ui.pasteToEditor(formatMentions(paths));
	};

	pi.registerShortcut("alt+o", { description: "Inserisci file o cartelle del progetto nel prompt (@percorso)", handler: insertMentions });
	pi.registerCommand("pick", {
		description: "Sfoglia il progetto e inserisci file o cartelle nel prompt (come Alt+O)",
		handler: async (_args, ctx) => insertMentions(ctx),
	});
}
