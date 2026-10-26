/**
 * /bugreport (Pi already has a built-in /bug that reports to its developers): a modal to report a problem. Confirming saves a package with everything useful to debug it (session, chat,
 * memory, goal, intent, todo, environment: see bug/bundle.ts) in ~/.pi/bugs/<date>-<title>/, whole, on this machine.
 * If a server is configured (PI_BUG_URL, ~/.pi/agent/bug.json) and the box is ticked, a copy with secrets hidden
 * is sent too. A failed send never loses the local package. PI_BUG=0 removes the command, PI_BUG_UPLOAD=0 the sending.
 *
 * Two helpers (both light, both ask first):
 * - at startup, crashes Pi wrote to crashes.json in the last 7 days and never offered are listed in a dialog; confirming makes one
 *   package per crash (kind "crash"). PI_BUG_CRASHES=0 turns it off.
 * - in the chat, a message that describes a problem of Pi / pi-claude (not of the user's code) gets a one-line hint to run
 *   /bugreport (Alt+B), prefilled with the message. Rules decide, a short haiku call only when unsure. PI_BUG_WATCH=0 turns it off.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { redactedCopy, trimSession, writeBundle, type BugForm } from "./bug/bundle.ts";
import { listBugs, login, saveSession, savedPassword, savedSession, type Session } from "./bug/admin.ts";
import { crashExists, crashForm, crashId, markSeen, readCrashes, readSeen, splitCrashes, type CrashEntry } from "./bug/crashes.ts";
import { DETECT_SYSTEM, looksLikePiBug, parseDetect } from "./bug/detect.ts";
import { openInBrowser, startViewer, type Viewer } from "./bug/viewer.ts";
import { sendWithProgress } from "./bug/progress.ts";
import { pack, upload, uploadConfig } from "./bug/upload.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.PI_BUG === "0") return;

	const report = async (ctx: ExtensionContext, form: BugForm, crash?: CrashEntry) => {
		const home = homedir();
		const dir = writeBundle(join(home, ".pi", "bugs"), {
			// A crash belongs to the folder and the session it happened in, not to the current ones.
			cwd: crash?.cwd && existsSync(crash.cwd) ? crash.cwd : ctx.cwd,
			crash,
			home,
			form,
			piVersion: VERSION,
			extensionRoot: join(dirname(fileURLToPath(import.meta.url)), ".."),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			sessionId: crash ? undefined : ctx.sessionManager.getSessionId(),
			sessionFile: crash ? (crashExists(crash) ? crash.sessionFile : undefined) : ctx.sessionManager.getSessionFile(),
			branch: crash ? [] : (ctx.sessionManager.getBranch() as unknown[]),
			systemPrompt: crash ? undefined : ctx.getSystemPrompt(),
			env: process.env,
			now: new Date(),
		});
		const config = form.send ? uploadConfig(process.env, home) : undefined;
		if (!config) return ctx.ui.notify(`Bug salvato in ${dir}`, "info");
		const file = pack(trimSession(form.redact ? redactedCopy(dir) : dir));
		await sendWithProgress(ctx.ui, () => upload(config, file, { title: form.title, severity: form.kind === "crash" ? "crash" : form.severity }), {
			sending: "Invio del bug al server…",
			done: (message) => `Bug ${message}. Copia locale in ${dir}`,
			failed: (message) => `Bug NON inviato: ${message}. Resta salvato in ${dir}`,
		});
	};

	/** Text of the message that looked like a Pi bug: /bugreport and Alt+B start from it. */
	let suggested: string | undefined;

	const openForm = async (ctx: ExtensionContext, start: Partial<BugForm> = {}) => {
		if (ctx.mode !== "tui") return ctx.ui.notify("/bugreport serve il terminale interattivo.", "warning");
		const { BugFormModal } = await import("../pi-ui/src/bug-form.ts");
		const config = uploadConfig(process.env, homedir());
		const form = await ctx.ui.custom<BugForm | undefined>(
			(tui, theme, _keybindings, done) =>
				new BugFormModal({ fg: (role, text) => theme.fg(role, text), bold: (text) => theme.bold(text) }, config ? new URL(config.url).host : undefined, done, () => tui.requestRender(), () => tui.terminal.rows, start),
			{ overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: "90%" } },
		);
		if (!form) return;
		try {
			await report(ctx, form);
		} catch (error) {
			ctx.ui.notify(`Bug non salvato: ${(error as Error).message}`, "error");
		}
	};
	const openSuggested = async (ctx: ExtensionContext) => {
		const text = suggested;
		suggested = undefined;
		await openForm(ctx, text ? { title: text.split("\n")[0].slice(0, 80), happened: text.slice(0, 1500) } : {});
	};

	pi.registerCommand("bugreport", {
		description: "Segnala un bug: salva sessione, chat, memoria, goal, intent e todo in ~/.pi/bugs/",
		handler: async (_args, ctx) => openSuggested(ctx),
	});
	pi.registerShortcut("alt+b" as Parameters<typeof pi.registerShortcut>[0], { description: "Segnala un bug (/bugreport)", handler: async (ctx) => openSuggested(ctx) });

	// --- the admin reads what arrived (password of the bug server; PI_BUG_ADMIN=0 removes the command) ------------------
	if (process.env.PI_BUG_ADMIN !== "0") {
		let active: Viewer | undefined;
		pi.registerCommand("bugs", {
			description: "Admin: leggi i bug ricevuti dal server (chiede la password del server dei bug)",
			handler: async (_args, ctx) => {
				const config = uploadConfig(process.env, homedir());
				if (!config) return void ctx.ui.notify("Server dei bug non configurato (PI_BUG_UPLOAD=0?).", "warning");
				const home = homedir();
				let session: Session | undefined = savedSession(home);
				let result = session ? await listBugs(config.url, session) : "login";
				if (result === "login") {
					const password = process.env.PI_BUG_ADMIN_PASSWORD || savedPassword(home) || (await ctx.ui.input("Password admin del server dei bug", ""));
					if (!password) return;
					const entered = await login(config.url, password);
					if (!entered.ok) return void ctx.ui.notify(`Accesso negato: ${entered.message}`, "warning");
					session = entered.session;
					saveSession(home, session);
					result = await listBugs(config.url, session);
				}
				if (result === "login" || "error" in result) return void ctx.ui.notify(result === "login" ? "Accesso scaduto, riprova." : result.error, "warning");
				if (!session) return;
				// The page: a local server, closed after 30 min idle or with its "Chiudi" button.
				active?.close();
				active = await startViewer({
					url: config.url,
					session,
					cacheDir: join(home, ".pi", "bugs", "received"),
					relogin: async () => {
						const password = process.env.PI_BUG_ADMIN_PASSWORD || savedPassword(home);
						const again = password ? await login(config.url, password) : undefined;
						if (again?.ok) saveSession(home, again.session);
						return again?.ok ? again.session : undefined;
					},
				});
				const opened = openInBrowser(active.url);
				ctx.ui.notify(opened ? `Pagina dei bug aperta nel browser (${result.bugs.length} bug). Si chiude da sola dopo 30 minuti senza uso.` : `Apri nel browser: ${active.url}`, "info");
			},
		});
		pi.on("session_shutdown", () => active?.close());
	}

	// --- crashes not yet reported -------------------------------------------------------------------------------------
	if (process.env.PI_BUG_CRASHES !== "0") {
		pi.on("session_start", (event, ctx) => {
			if (event.reason !== "startup" || !ctx.hasUI || ctx.mode !== "tui") return;
			const home = homedir();
			const { fresh, skip } = splitCrashes(readCrashes(home), readSeen(home), new Date());
			if (skip.length) markSeen(home, skip.map(crashId));
			if (!fresh.length) return;
			// Not awaited: the dialog must not hold the startup.
			void (async () => {
				try {
					await new Promise((resolve) => setTimeout(resolve, 1500));
					const config = uploadConfig(process.env, home);
					const SEND = config ? `Invia ${fresh.length === 1 ? "il crash" : `i ${fresh.length} crash`} (chiavi oscurate) e salva in locale` : "";
					const SAVE = "Salva solo sul mio disco";
					const NO = "Non ora, ignora";
					const list = fresh.slice(0, 5).map((c) => `• ${c.timestamp.slice(0, 16).replace("T", " ")} · ${c.message.split("\n")[0].slice(0, 70)}`).join("\n");
					const choice = await ctx.ui.select(`Pi si è chiuso ${fresh.length === 1 ? "una volta" : `${fresh.length} volte`} negli ultimi 7 giorni senza che tu lo segnalassi:\n${list}${fresh.length > 5 ? `\n… e altri ${fresh.length - 5}` : ""}`, [...(config ? [SEND] : []), SAVE, NO]);
					markSeen(home, fresh.map(crashId));
					if (choice !== SEND && choice !== SAVE) return;
					for (const crash of fresh) await report(ctx, crashForm(crash, choice === SEND), crash);
				} catch {
					// ctx gone (reload, new session): nothing to do, the crashes were or will be marked
				}
			})();
		});
	}

	// --- a message that describes a problem of Pi ---------------------------------------------------------------------
	if (process.env.PI_BUG_WATCH !== "0") {
		const hint = (ctx: ExtensionContext, text: string) => {
			suggested = text;
			ctx.ui.notify("Sembra un problema di Pi o di pi-claude: premi Alt+B (o scrivi /bugreport) per segnalarlo, con questo messaggio già nel modulo.", "info");
		};
		const askModel = async (ctx: ExtensionContext, text: string): Promise<boolean> => {
			const model = ctx.modelRegistry.find("claude-code", process.env.PI_DREAM_MODEL ?? "haiku");
			if (!model) return false;
			const stream = ctx.modelRegistry.streamSimple(model, {
				systemPrompt: DETECT_SYSTEM,
				messages: [{ role: "user", content: [{ type: "text", text: text.slice(0, 1200) }], timestamp: Date.now() }],
			} as never);
			for await (const _event of stream) {
				// drain: the final message has the answer
			}
			const message = await stream.result();
			return message.stopReason !== "error" && parseDetect(message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(""));
		};
		pi.on("input", (event, ctx) => {
			if (event.source !== "interactive" || event.streamingBehavior || !ctx.hasUI) return { action: "continue" };
			const text = event.text.trim();
			if (!text || text.startsWith("/")) return { action: "continue" };
			const verdict = looksLikePiBug(text);
			if (verdict === "yes") hint(ctx, text);
			// Never awaited: the message goes to the model without delay; the hint comes a moment later if the model says yes.
			else if (verdict === "maybe")
				void askModel(ctx, text).then((yes) => yes && hint(ctx, text)).catch(() => undefined);
			return { action: "continue" };
		});
	}
}
