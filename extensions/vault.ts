/**
 * /vault: CLAUDE.md files and the local Obsidian vault (when there is one), chunked by section and embedded with the
 * local model. Nothing starts by itself: at session start only the pending notes are counted (footer); /vault index
 * asks first, with an estimate. The model gets two tools (vault_search, vault_read) and one short line in the prompt.
 * PI_VAULT=<folder> points to the vault (else the first folder upward with .obsidian/); PI_VAULT_OFF=1 turns it off.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Embedder } from "../pi-memory/src/embed.ts";
import { chunkMarkdown } from "./vault/chunk.ts";
import { type Hit, type SearchFilter, VaultIndex } from "./vault/index.ts";
import { type LoaderState, type Step, loaderLines, loaderScreen } from "./vault/loader.ts";
import { extractRules, ruleCandidates, ruleReason, rulesFor, type Confirmed, type Rule } from "./vault/rules.ts";
import { claudeMdFiles, findVault, readSources } from "./vault/scan.ts";

const DIR = ".pi/vault";
const MODEL_NAME = "Xenova/multilingual-e5-small";
/** Measured 20 Oct on 16 CPU threads without GPU, real notes (e5-small): 4.6 sections/s (a synthetic benchmark of short uniform texts gave 15, not representative). */
const CHUNKS_PER_SECOND = Number(process.env.PI_VAULT_RATE) || 5;
/** Tests inject a deterministic embedder here instead of loading the real model. */
export const hooks: { embedder?: Embedder & { ready?: boolean; start?: () => Promise<boolean> }; startup?: Promise<unknown> } = {};
const modelName = () => hooks.embedder?.model ?? MODEL_NAME;
export const PROMPT_MARKER = "Vault:";
const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], details: undefined, ...(isError ? { isError } : {}) });

export const promptLine = (notes: number, name: string) => `${PROMPT_MARKER} ${notes} note indicizzate (${name}). Usa vault_search se la domanda riguarda note, convenzioni o decisioni del progetto.`;

export function formatHits(hits: Hit[]): string {
	if (!hits.length) return "Nessun risultato pertinente.";
	return hits.map((hit) => {
		const body = hit.text.slice(hit.text.indexOf("\n") + 1).replace(/\s+/g, " ").trim();
		return `${hit.path}${hit.section ? ` › ${hit.section}` : ""} (riga ${hit.line})${hit.tags.length ? ` #${hit.tags.slice(0, 4).join(" #")}` : ""}\n  ${body.length > 240 ? `${body.slice(0, 240)}…` : body}`;
	}).join("\n");
}

export const estimateText = (plan: { chunks: number; pending: number; removed: number }) => {
	const seconds = Math.ceil(plan.pending / CHUNKS_PER_SECOND);
	const time = seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
	return `${plan.chunks} sezioni, ${plan.pending} da calcolare (${plan.removed} da togliere), circa ${time} su CPU (stima a ${CHUNKS_PER_SECOND} sezioni al secondo). Token: 0, tutto in locale.`;
};

export default function (pi: ExtensionAPI) {
	if (process.env.PI_VAULT_OFF === "1") return;
	const cwd0 = process.cwd();
	if (!findVault(cwd0) && !claudeMdFiles(cwd0).length) return;

	let embedder: (Embedder & { ready?: boolean; start?: () => Promise<boolean> }) | undefined;
	let index: VaultIndex | undefined;
	let running = false;
	const show = (title: string, body: string) => pi.sendMessage({ customType: "vault-report", content: `${title}\n${body}`, display: true });
	const indexPath = (cwd: string) => join(cwd, DIR, "index.json");

	const load = (cwd: string) => {
		if (index) return index;
		try {
			index = VaultIndex.fromJSON(JSON.parse(readFileSync(indexPath(cwd), "utf8")));
		} catch {
			index = new VaultIndex();
		}
		return index;
	};
	const save = (cwd: string) => {
		mkdirSync(join(cwd, DIR), { recursive: true });
		writeFileSync(join(cwd, DIR, ".gitignore"), "*\n");
		writeFileSync(indexPath(cwd), JSON.stringify(load(cwd).toJSON()));
	};
	const getEmbedder = async () => {
		if (hooks.embedder) return hooks.embedder;
		if (!embedder) {
			const { WorkerEmbedder, MODELS } = await import("../pi-memory/src/embed.ts");
			embedder = new WorkerEmbedder(MODELS.e5);
		}
		return embedder;
	};
	const label = (cwd: string) => {
		const vault = findVault(cwd);
		return vault ? vault.split("/").pop() || vault : "CLAUDE.md";
	};

	/** Footer: how many sections are waiting (counted without the model); cleared when up to date. */
	const refreshStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		try {
			const sources = readSources(ctx.cwd, findVault(ctx.cwd));
			const plan = load(ctx.cwd).plan(sources, modelName());
			// The session panel's VAULT section.
			pi.events?.emit("vault:state", { name: label(ctx.cwd), files: sources.length, notes: load(ctx.cwd).paths.length, sections: load(ctx.cwd).size, pending: plan.pending, removed: plan.removed });
			ctx.ui.setStatus("vault", plan.pending || plan.removed ? `Vault: ${plan.pending} sezioni da indicizzare, scrivi /vault` : undefined);
		} catch {
			ctx.ui.setStatus("vault", undefined);
			pi.events?.emit("vault:state", undefined);
		}
	};

	/** At startup: when CLAUDE.md or a vault has notes not indexed yet, ask once; yes = index now with the loader. Never blocks the start of the session. */
	pi.on("session_start", (_event, ctx) => {
		refreshStatus(ctx);
		syncTools(ctx);
		if (!ctx.hasUI) return;
		hooks.startup = (async () => {
			try {
				const sources = readSources(ctx.cwd, findVault(ctx.cwd));
				const plan = load(ctx.cwd).plan(sources, modelName());
				if (!sources.length || (!plan.pending && !plan.removed)) return;
				const found = [claudeMdFiles(ctx.cwd).length ? "CLAUDE.md" : "", findVault(ctx.cwd) ? "il vault" : ""].filter(Boolean).join(" e ");
				if (!(await ctx.ui.confirm(`Analizzare ${found}?`, `${sources.length} file. ${estimateText(plan)} Parte in background, puoi continuare a lavorare.`))) return;
				if (running) return;
				running = true;
				try {
					show("Indicizzazione", await reindex(ctx, true));
				} finally {
					running = false;
				}
			} catch (error) {
				ctx.ui.notify(`Vault: ${(error as Error).message}`, "warning");
			}
		})();
	});

	const rulesFile = (cwd: string) => join(cwd, DIR, "regole.json");
	const confirmedRules = (cwd: string): Confirmed[] => {
		try {
			return JSON.parse(readFileSync(rulesFile(cwd), "utf8"));
		} catch {
			return [];
		}
	};
	let turnRules: Rule[] | undefined;
	const shown = new Set<string>();
	pi.on("before_agent_start", (event, ctx) => {
		// New turn: rules are read again (notes may have changed) and may be shown again.
		turnRules = undefined;
		shown.clear();
		if (event.systemPrompt.includes(PROMPT_MARKER)) return;
		const current = load(ctx.cwd);
		if (current.size) return { systemPrompt: `${event.systemPrompt}\n\n${promptLine(current.paths.length, label(ctx.cwd))}` };
	});

	/**
	 * Rule gate: the first edit/write of a turn that touches a file covered by a rule (`type: regola`, `paths:`) is blocked
	 * once with those rules as the reason; the retry goes through. Zero tokens in turns that write nothing.
	 */
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
		const file = String((event.input as { path?: string; file_path?: string })?.path ?? (event.input as { file_path?: string })?.file_path ?? "");
		if (!file) return undefined;
		try {
			turnRules ??= extractRules(readSources(ctx.cwd, findVault(ctx.cwd)), confirmedRules(ctx.cwd));
			const fresh = rulesFor(turnRules, file, ctx.cwd).filter((rule) => !shown.has(rule.path));
			if (!fresh.length) return undefined;
			fresh.forEach((rule) => shown.add(rule.path));
			return { block: true, reason: ruleReason(fresh, file) };
		} catch {
			return undefined;
		}
	});

	/** The two tools cost schema tokens on every request: declared to the model only when an index exists. */
	const syncTools = (ctx: ExtensionContext) => {
		const ours = ["vault_search", "vault_read"];
		const active = pi.getActiveTools();
		const wanted = load(ctx.cwd).size > 0;
		const next = wanted ? [...new Set([...active, ...ours])] : active.filter((name) => !ours.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};

	/**
	 * The loader: a full-screen overlay (Invio/B sends it to the background, Esc cancels), then the small widget above the
	 * editor. Without `ctx.ui.custom` (tests, no UI) only the widget. Undefined state clears everything.
	 */
	let loaderTimer: ReturnType<typeof setInterval> | undefined;
	let closeOverlay: (() => void) | undefined;
	const loader = (ctx: ExtensionContext, state?: () => LoaderState, onCancel: () => void = () => {}): (() => void) => {
		if (loaderTimer) clearInterval(loaderTimer);
		loaderTimer = undefined;
		closeOverlay?.();
		closeOverlay = undefined;
		if (!ctx.hasUI) return () => {};
		if (!state) {
			ctx.ui.setWidget("vault", undefined);
			return () => {};
		}
		let renderScreen: (() => void) | undefined;
		let background = typeof ctx.ui.custom !== "function";
		const rates: number[] = [];
		let last = { at: Date.now(), done: 0 };
		const draw = () => {
			const now = Date.now();
			const current = state();
			if (now - last.at >= 600) {
				rates.push(Math.max(0, (current.done - last.done) / ((now - last.at) / 1000)));
				last = { at: now, done: current.done };
			}
			if (background) ctx.ui.setWidget("vault", loaderLines({ ...current, now }));
			else renderScreen?.();
		};
		if (!background) {
			ctx.ui.setWidget("vault", undefined);
			void ctx.ui.custom<void>(
				(tui, _theme, _keys, done) => {
					renderScreen = () => tui.requestRender();
					closeOverlay = () => done(undefined);
					return {
						render: (width: number) => loaderScreen({ ...state(), rates, now: Date.now() }, width, tui.terminal.rows),
						invalidate: () => {},
						handleInput: (data: string) => {
							if (data === "\x1b") onCancel();
							else if (data === "\r" || data === "\n" || data.toLowerCase() === "b") {
								background = true;
								done(undefined);
								draw();
							}
						},
					};
				},
				{ overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%" } },
			).catch(() => {
				background = true;
			});
		}
		draw();
		loaderTimer = setInterval(draw, 100);
		return draw;
	};

	/** Remember files already read for the feed: a new path pushes the previous one. */
	const feedFile = (state: LoaderState, path: string) => {
		const before = state.current.split(" › ")[0];
		if (before && before !== path && !state.feed?.includes(before)) state.feed = [...(state.feed ?? []), before].slice(-12);
	};

	const reindex = async (ctx: ExtensionContext, confirmed = false): Promise<string> => {
		const sources = readSources(ctx.cwd, findVault(ctx.cwd));
		if (!sources.length) return "Nessuna nota trovata.";
		const plan = load(ctx.cwd).plan(sources, modelName());
		if (!plan.pending && !plan.removed) return `Indice aggiornato: ${plan.chunks} sezioni da ${sources.length} file.`;
		if (!confirmed && ctx.hasUI && !(await ctx.ui.confirm("Indicizza note", `${sources.length} file. ${estimateText(plan)} Procedere?`))) return "Indicizzazione annullata.";
		const started = Date.now();
		const state: LoaderState = { step: "lettura", files: sources.length, done: 0, total: plan.pending, filesDone: 0, filesTotal: 0, current: "", startedAt: started, now: started };
		let redraw = () => {};
		const go = (step: Step, current = "") => (Object.assign(state, { step, current }), redraw());
		const abort = new AbortController();
		const stop = ctx.hasUI ? ctx.ui.onTerminalInput((data) => (data === "\x1b" ? (abort.abort(), { consume: true }) : undefined)) : () => {};
		redraw = loader(ctx, () => state, () => abort.abort());
		try {
			go("modello");
			const model = await getEmbedder();
			if (!(await model.start?.())) return "Modello locale non disponibile: indice non aggiornato.";
			go("vettori");
			const stats = await load(ctx.cwd).update(sources, model, (progress) => (feedFile(state, progress.path), (pi.events?.emit("vault:state", { name: label(ctx.cwd), files: sources.length, notes: load(ctx.cwd).paths.length, sections: load(ctx.cwd).size, pending: plan.pending, removed: plan.removed, progress: { done: progress.done, total: progress.total, current: progress.path } })), Object.assign(state, { done: progress.done, total: progress.total, filesDone: progress.filesDone, filesTotal: progress.filesTotal, current: progress.path ? `${progress.path}${progress.section ? ` › ${progress.section}` : ""}` : "" }), redraw()), abort.signal);
			go("salvataggio");
			save(ctx.cwd);
			return `Indice aggiornato in ${((Date.now() - started) / 1000).toFixed(1)} s: ${stats.files} file, ${stats.chunks} sezioni (${stats.embedded} calcolate, ${stats.reused} riusate, ${stats.removed} tolte). Token usati: 0.`;
		} catch (error) {
			if (abort.signal.aborted) return "Indicizzazione annullata: nulla salvato, le sezioni già calcolate vanno rifatte.";
			throw error;
		} finally {
			stop();
			loader(ctx);
			refreshStatus(ctx);
			syncTools(ctx);
		}
	};

	const search = async (ctx: ExtensionContext, query: string, k: number, filter: SearchFilter = {}) => {
		const current = load(ctx.cwd);
		if (!current.size) return { error: "Vault non indicizzato: l'utente deve eseguire /vault." };
		const model = await getEmbedder();
		if (model.ready === false && !(await model.start?.())) return { error: "Modello locale non disponibile." };
		const mode = process.env.PI_VAULT_SEARCH === "vector" ? "vector" : "hybrid";
		const hits = await current.search(query, model, k, mode, filter);
		// Notes edited after the last index: say so (nothing is re-indexed by itself).
		const stale = current.plan(readSources(ctx.cwd, findVault(ctx.cwd)), modelName());
		return { hits, stale: stale.pending + stale.removed };
	};

	pi.registerCommand("vault", {
		description: "CLAUDE.md e vault Obsidian: indicizza (con conferma), stato, cerca. /vault index | status | search <testo> | regole",
		handler: async (args, ctx) => {
			const [command = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
			if (running) return void ctx.ui.notify("Operazione del vault già in corso.", "warning");
			running = true;
			try {
				let choice = command === "regole" ? "rules" : command;
				if (!choice) {
					if (!ctx.hasUI) return void ctx.ui.notify("Uso: /vault index | status | search <testo> | regole", "info");
					const picked = await ctx.ui.select("Vault e CLAUDE.md", ["Stato", "Indicizza o aggiorna", "Cerca…", "Regole dedotte…", "Esci"]);
					choice = picked === "Stato" ? "status" : picked?.startsWith("Indicizza") ? "index" : picked?.startsWith("Cerca") ? "search" : picked?.startsWith("Regole") ? "rules" : "";
				}
				if (choice === "status") {
					const sources = readSources(ctx.cwd, findVault(ctx.cwd));
					const plan = load(ctx.cwd).plan(sources, modelName());
					const vault = findVault(ctx.cwd);
					return show("Stato del vault", `Vault: ${vault ?? "nessuno"}. CLAUDE.md: ${claudeMdFiles(ctx.cwd).map((item) => item.id).join(", ") || "nessuno"}.\nIndicizzate: ${load(ctx.cwd).size} sezioni. In coda: ${plan.pending}, da togliere: ${plan.removed} (${plan.chunks} sezioni in ${sources.length} file).`);
				}
				if (choice === "rules") {
					if (!ctx.hasUI) return;
					const known = confirmedRules(ctx.cwd);
					const found = ruleCandidates(readSources(ctx.cwd, findVault(ctx.cwd)), known);
					if (!found.length) return show("Regole", "Nessuna sezione che sembri una regola da confermare. Marca una nota con `type: regola` (e `paths:`) per renderla regola.");
					const accepted: Confirmed[] = [];
					for (const item of found) {
						if (await ctx.ui.confirm(`Regola? ${item.path} › ${item.section}`, `${item.text.slice(0, 400)}\n\nSe confermi, vale per ogni file che scrivo (solo i testi di regole confermate entrano nel contesto).`)) accepted.push({ path: item.path, section: item.section });
					}
					if (accepted.length) {
						mkdirSync(join(ctx.cwd, DIR), { recursive: true });
						writeFileSync(rulesFile(ctx.cwd), JSON.stringify([...known, ...accepted], null, 1));
					}
					return show("Regole", `${accepted.length} confermate su ${found.length} proposte.`);
				}
				if (choice === "index") return show("Indicizzazione", await reindex(ctx));
				if (choice === "search") {
					const query = rest.join(" ") || (ctx.hasUI ? await ctx.ui.input("Cerca nelle note", "parole o domanda") : undefined);
					if (!query?.trim()) return;
					const result = await search(ctx, query, 6);
					return show(`Cerca: ${query}`, result.error ?? formatHits(result.hits ?? []));
				}
			} finally {
				running = false;
			}
		},
	});

	pi.registerTool({
		name: "vault_search",
		label: "Vault search",
		description: "Search the user's notes and CLAUDE.md (meaning, exact words, file names). Nothing relevant: retry with other words before giving up. Filters: tag, folder.",
		parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, tag: { type: "string" }, folder: { type: "string" } }, required: ["query"] } as never,
		async execute(_id, raw, _signal, _update, ctx) {
			const params = raw as { query: string; limit?: number; tag?: string; folder?: string };
			const result = await search(ctx, params.query, Math.min(Math.max(params.limit ?? 6, 1), 15), { tag: params.tag, folder: params.folder });
			if (result.error) return text(result.error, true);
			const note = result.stale ? `\n(Attenzione: ${result.stale} sezioni modificate dopo l'indicizzazione, i risultati possono essere vecchi: l'utente può eseguire /vault index.)` : "";
			return text(formatHits(result.hits ?? []) + note);
		},
	});

	pi.registerTool({
		name: "vault_read",
		label: "Vault read",
		description: "Read a note (or one section) by path from vault_search; shows its links and backlinks.",
		parameters: { type: "object", properties: { path: { type: "string" }, section: { type: "string" } }, required: ["path"] } as never,
		async execute(_id, raw, _signal, _update, ctx) {
			const params = raw as { path: string; section?: string };
			const file = resolveSource(ctx.cwd, params.path);
			if (!file) return text(`Percorso non valido: ${params.path}`, true);
			const source = readFileSync(file, "utf8");
			const body = params.section ? chunkMarkdown(params.path, source).filter((chunk) => chunk.section === params.section || chunk.section.startsWith(`${params.section} › `)).map((chunk) => chunk.text.slice(chunk.text.indexOf("\n") + 1)).join("\n\n") : source;
			if (!body) return text(`Sezione non trovata: ${params.section}`, true);
			const shown = body.length > 6000 ? `${body.slice(0, 6000)}\n… (tagliato, ${body.length} caratteri)` : body;
			if (params.section) return text(shown);
			const { links, backlinks } = load(ctx.cwd).relations(params.path);
			const related = [links.length ? `Collegamenti: ${links.slice(0, 15).join(", ")}` : "", backlinks.length ? `Collegata da: ${backlinks.slice(0, 15).join(", ")}` : ""].filter(Boolean).join("\n");
			return text(related ? `${shown}\n\n---\n${related}` : shown);
		},
	});
}

/** A source id to a real file: CLAUDE.md ids, or a path inside the vault (never outside it). */
export function resolveSource(cwd: string, id: string, home = homedir()): string | undefined {
	const known = claudeMdFiles(cwd, home).find((item) => item.id === id);
	if (known) return known.file;
	const vault = findVault(cwd);
	if (!vault) return undefined;
	const file = resolve(vault, id);
	const rel = relative(vault, file);
	return rel && !rel.startsWith("..") && !rel.startsWith("/") && file.toLowerCase().endsWith(".md") && existsSync(file) ? file : undefined;
}
