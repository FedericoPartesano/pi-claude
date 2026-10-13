/**
 * /bugreport (Pi already has a built-in /bug that reports to its developers): a modal to report a problem. Confirming saves a package with everything useful to debug it (session, chat,
 * memory, goal, intent, todo, environment: see bug/bundle.ts) in ~/.pi/bugs/<date>-<title>/, whole, on this machine.
 * If a server is configured (PI_BUG_URL, ~/.pi/agent/bug.json) and the box is ticked, a copy with secrets hidden
 * is sent too. A failed send never loses the local package. PI_BUG=0 removes the command, PI_BUG_UPLOAD=0 the sending.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { redactedCopy, writeBundle, type BugForm } from "./bug/bundle.ts";
import { pack, upload, uploadConfig } from "./bug/upload.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.PI_BUG === "0") return;

	const report = async (ctx: ExtensionCommandContext, form: BugForm) => {
		const home = homedir();
		const dir = writeBundle(join(home, ".pi", "bugs"), {
			cwd: ctx.cwd,
			home,
			form,
			piVersion: VERSION,
			extensionRoot: join(dirname(fileURLToPath(import.meta.url)), ".."),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			sessionId: ctx.sessionManager.getSessionId(),
			sessionFile: ctx.sessionManager.getSessionFile(),
			branch: ctx.sessionManager.getBranch() as unknown[],
			systemPrompt: ctx.getSystemPrompt(),
			env: process.env,
			now: new Date(),
		});
		const config = form.send ? uploadConfig(process.env, home) : undefined;
		if (!config) return ctx.ui.notify(`Bug salvato in ${dir}`, "info");
		ctx.ui.notify(`Bug salvato in ${dir}. Lo invio…`, "info");
		const file = pack(form.redact ? redactedCopy(dir) : dir);
		const result = await upload(config, file, { title: form.title, severity: form.severity });
		ctx.ui.notify(result.ok ? `Bug ${result.message}. Copia locale in ${dir}` : `Bug salvato in ${dir}, ma ${result.message}.`, result.ok ? "info" : "warning");
	};

	pi.registerCommand("bugreport", {
		description: "Segnala un bug: salva sessione, chat, memoria, goal, intent e todo in ~/.pi/bugs/",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return ctx.ui.notify("/bugreport serve il terminale interattivo.", "warning");
			const { BugFormModal } = await import("../pi-ui/src/bug-form.ts");
			const config = uploadConfig(process.env, homedir());
			const form = await ctx.ui.custom<BugForm | undefined>(
				(tui, theme, _keybindings, done) =>
					new BugFormModal({ fg: (role, text) => theme.fg(role, text), bold: (text) => theme.bold(text) }, config ? new URL(config.url).host : undefined, done, () => tui.requestRender(), () => tui.terminal.rows),
				{ overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "90%" } },
			);
			if (!form) return;
			try {
				await report(ctx, form);
			} catch (error) {
				ctx.ui.notify(`Bug non salvato: ${(error as Error).message}`, "error");
			}
		},
	});
}
