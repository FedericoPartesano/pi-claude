/**
 * micelio: the team memory in its own panel. A shortcut (F6, PI_MICELIO_KEY changes it; alt+s stays the session
 * panel). Keys chosen for this setup: Ctrl+Alt+letter is AltGr on the Windows layout (types a character), Alt+H/J/K/L and
 * most other Alt letters are komorebi's whkd, Alt+P/Q/V/Z are Pi's own on WSL opens a column on the right with the memories Micelio returns, shown as it returns them: one card each. The
 * chat keeps the keyboard; alt+w (PI_MICELIO_FOCUS_KEY) moves it into the panel and back, a click does too. In the
 * panel: ↑↓ to move, Enter to open or close a card and read the whole memory, Esc back to the chat. Search: at session start on the project name, then on
 * the words of each prompt; `/micelio <words>` searches by hand. Without Micelio (no server in Pi's MCP config, not
 * reachable) the extension stays silent: nothing registered, or just "offline" in the panel. PI_MICELIO=0 turns it off.
 * The auth header from the MCP config is only sent, never shown. Zero tokens: nothing goes to the model.
 */
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMicelioConfig, MicelioClient } from "./micelio/client.ts";
import { keywordsOf, parseMemories, type Memory } from "./micelio/memories.ts";
import type { Handle } from "./micelio/panel.ts";

const KEY = (process.env.PI_MICELIO_KEY || "f6").toLowerCase();
const FOCUS_KEY = (process.env.PI_MICELIO_FOCUS_KEY || "alt+w").toLowerCase();
const TIMEOUT_MS = 6000;

type Status = "idle" | "loading" | "ok" | "offline";

export default function (pi: ExtensionAPI) {
	if (process.env.PI_MICELIO === "0") return;
	const config = loadMicelioConfig();
	if (!config) return; // Micelio is not in this Pi's MCP config: nothing to show
	const client = new MicelioClient(config);

	let status: Status = "idle";
	let query = "";
	let memories: Memory[] = [];
	let statusCtx: ExtensionContext | undefined;
	let panel: Handle | undefined;
	let redraw: (() => void) | undefined;
	let latest = 0;

	const showStatus = () => {
		try {
			statusCtx?.ui.setStatus("micelio", status === "ok" ? `Micelio ${memories.length}` : status === "loading" ? "Micelio …" : status === "offline" ? "Micelio offline" : undefined);
		} catch {
			statusCtx = undefined; // stale context after a reload
		}
		redraw?.();
	};

	async function search(words: string): Promise<void> {
		if (words.length < 2) return;
		const mine = ++latest;
		query = words;
		status = "loading";
		showStatus();
		try {
			const text = await client.recall(words, 8, AbortSignal.timeout(TIMEOUT_MS));
			if (mine !== latest) return; // a newer search is on its way
			memories = parseMemories(text);
			status = "ok";
		} catch {
			if (mine !== latest) return;
			memories = [];
			status = "offline";
		}
		showStatus();
		pi.events.emit("micelio:state", { status, query, count: memories.length });
	}

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		statusCtx = ctx;
		void search(basename(ctx.cwd));
	});
	pi.on("before_agent_start", (event) => {
		void search(keywordsOf(event.prompt));
	});

	// The chat keeps the keyboard when the panel opens; `withFocus` moves it in at once (the focus key).
	const openPanel = async (ctx: ExtensionContext | ExtensionCommandContext, withFocus = false): Promise<void> => {
		if (panel) return panel.close();
		if (ctx.mode !== "tui") return;
		try {
			// Loaded here: pi-tui exists only inside Pi.
			const { openMicelioPanel } = await import("./micelio/panel.ts");
			await openMicelioPanel(ctx, () => ({ status, query, memories }), KEY, FOCUS_KEY, (handle) => {
				panel = handle;
				redraw = handle.redraw;
				if (withFocus) setTimeout(() => handle.focus(), 0);
			});
		} catch (error) {
			ctx.ui.notify(`Micelio: pannello non disponibile (${error instanceof Error ? error.message : String(error)})`, "error");
		} finally {
			panel = undefined;
			redraw = undefined;
		}
	};
	// The focus key: panel closed → open it with the keyboard in; open → move the keyboard between chat and panel.
	const moveFocus = async (ctx: ExtensionContext): Promise<void> => {
		if (!panel) return openPanel(ctx, true);
		if (panel.isFocused()) panel.blur();
		else panel.focus();
	};

	pi.registerShortcut(KEY as Parameters<typeof pi.registerShortcut>[0], { description: "Pannello Micelio: i ricordi del team", handler: (ctx) => openPanel(ctx) });
	pi.registerShortcut(FOCUS_KEY as Parameters<typeof pi.registerShortcut>[0], { description: "Sposta la tastiera tra la chat e il pannello Micelio", handler: (ctx) => moveFocus(ctx) });
	pi.registerCommand("micelio", {
		description: "Pannello Micelio (come " + KEY + "; " + FOCUS_KEY + " sposta la tastiera): /micelio apre · /micelio <parole> cerca",
		handler: async (args, ctx) => {
			statusCtx = ctx.hasUI ? ctx : statusCtx;
			const words = args.trim();
			if (words) void search(words);
			await openPanel(ctx);
		},
	});
	pi.on("session_shutdown", () => {
		panel?.close();
		statusCtx = undefined;
	});
}
