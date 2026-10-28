/**
 * micelio: the team memory in its own panel. A shortcut (alt+k, PI_MICELIO_KEY changes it; alt+s stays the session
 * panel) opens a column on the right with the memories Micelio returns, shown as it returns them: one card each, ↑↓ to
 * move, Enter to open or close a card and read the whole memory. Search: at session start on the project name, then on
 * the words of each prompt; `/micelio <words>` searches by hand. Without Micelio (no server in Pi's MCP config, not
 * reachable) the extension stays silent: nothing registered, or just "offline" in the panel. PI_MICELIO=0 turns it off.
 * The auth header from the MCP config is only sent, never shown. Zero tokens: nothing goes to the model.
 */
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMicelioConfig, MicelioClient } from "./micelio/client.ts";
import { cardLines, keywordsOf, parseMemories, type Memory, type Paint } from "./micelio/memories.ts";

const KEY = (process.env.PI_MICELIO_KEY || "alt+k").toLowerCase();
const PANEL_WIDTH = 56;
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
	let closePanel: (() => void) | undefined;
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

	const openPanel = async (ctx: ExtensionContext | ExtensionCommandContext): Promise<void> => {
		if (closePanel) return closePanel();
		if (ctx.mode !== "tui") return;
		const { matchesKey } = await import("@earendil-works/pi-tui");
		const open = new Set<string>();
		let selected = 0;
		let scroll = 0;
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				closePanel = () => done();
				redraw = () => tui.requestRender();
				const typeColors: Record<string, "accent" | "warning" | "success" | "error" | "muted"> = { fact: "accent", gotcha: "warning", decision: "accent", reference: "muted", howto: "success" };
				const paint: Paint = {
					chip: (type, text) => theme.bold(theme.fg(typeColors[type] ?? "muted", text)),
					title: (text) => theme.bold(text),
					dim: (text) => theme.fg("dim", text),
					frame: (text, isSelected) => theme.fg(isSelected ? "accent" : "borderMuted", text),
				};
				return {
					render(width: number): string[] {
						const rows = Math.max(8, (process.stdout.rows ?? 30) - 2);
						const head = [`${theme.bold(theme.fg("accent", "Micelio"))} ${theme.fg("dim", status === "offline" ? "non raggiungibile" : status === "loading" ? "ricerca…" : `${memories.length} ricordi · «${query}»`)}`, ""];
						const foot = theme.fg("dim", "↑↓ scegli · Invio apri/chiudi · Esc chiudi");
						const body: string[] = [];
						let top = 0;
						let bottom = 0;
						memories.forEach((memory, index) => {
							const card = cardLines(memory, width, open.has(memory.id), index === selected, paint);
							if (index === selected) {
								top = body.length;
								bottom = body.length + card.length;
							}
							body.push(...card);
						});
						if (!memories.length && status === "ok") body.push(theme.fg("dim", "Micelio non ha restituito ricordi."));
						const room = rows - head.length - 1;
						if (top < scroll) scroll = top;
						if (bottom > scroll + room) scroll = Math.min(top, bottom - room);
						return [...head, ...body.slice(scroll, scroll + room), foot];
					},
					handleInput(data: string) {
						const last = Math.max(0, memories.length - 1);
						if (matchesKey(data, "escape") || matchesKey(data, KEY as never)) return done();
						if (matchesKey(data, "up")) selected = Math.max(0, selected - 1);
						else if (matchesKey(data, "down")) selected = Math.min(last, selected + 1);
						else if (matchesKey(data, "enter") || matchesKey(data, "space")) {
							const id = memories[selected]?.id;
							if (id) open.has(id) ? open.delete(id) : open.add(id);
						}
						tui.requestRender();
					},
					invalidate() {},
				};
			},
			{ overlay: true, overlayOptions: { anchor: "top-right", width: PANEL_WIDTH, maxHeight: "100%", margin: { top: 0, right: 0 }, visible: (width) => width >= 80 } },
		);
		closePanel = undefined;
		redraw = undefined;
	};

	pi.registerShortcut(KEY as Parameters<typeof pi.registerShortcut>[0], { description: "Pannello Micelio: i ricordi del team", handler: (ctx) => openPanel(ctx) });
	pi.registerCommand("micelio", {
		description: "Pannello Micelio (come " + KEY + "): /micelio apre · /micelio <parole> cerca",
		handler: async (args, ctx) => {
			statusCtx = ctx.hasUI ? ctx : statusCtx;
			const words = args.trim();
			if (words) void search(words);
			await openPanel(ctx);
		},
	});
	pi.on("session_shutdown", () => {
		closePanel?.();
		statusCtx = undefined;
	});
}
