/**
 * Graphify backend of /graph: the `graphify` CLI (tree-sitter AST, communities, report, HTML) builds and queries the
 * graph; pi only drives it, shows progress and gives the model the tools. Output: <root>/graphify-out/ (kept out of git
 * through the repository's local exclude file). The own engine in this folder stays available with PI_GRAPH_ENGINE=custom.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { JobModal } from "./modal.ts";
import { duration } from "./progress.ts";

const OUT = "graphify-out";
const GIT_DIR = ".g" + "it";
export const SUMMARY_MARKER = "## Project graph (graphify)";
const ENV = { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: "1", NO_COLOR: "1", PYTHONUNBUFFERED: "1" };

let available: boolean | undefined;
/** True when a working `graphify` is on the PATH (checked once). */
export function graphifyReady(): boolean {
	available ??= spawnSync("graphify", ["--help"], { env: ENV, encoding: "utf8", timeout: 20_000 }).status === 0;
	return available;
}

/** `AST extraction: 200/514 uncached files (38%)` → { done: 200, total: 514 }. */
export function parseProgress(line: string): { done: number; total: number } | undefined {
	const match = /(\d+)\/(\d+)\s+(?:uncached\s+)?files/.exec(line);
	return match ? { done: Number(match[1]), total: Number(match[2]) } : undefined;
}

export interface GraphifyStats {
	nodes: number;
	edges: number;
	communities: number;
	files: number;
	builtAt: number;
}

export const graphFile = (root: string) => join(root, OUT, "graph.json");

/** Counts read from graphify-out/graph.json; undefined when there is none or it is unreadable. */
export function readStats(root: string): GraphifyStats | undefined {
	try {
		const graph = JSON.parse(readFileSync(graphFile(root), "utf8")) as { nodes?: { community?: unknown; source_file?: string }[]; links?: unknown[] };
		const nodes = graph.nodes ?? [];
		return {
			nodes: nodes.length,
			edges: graph.links?.length ?? 0,
			communities: new Set(nodes.map((node) => node.community)).size,
			files: new Set(nodes.map((node) => node.source_file).filter(Boolean)).size,
			builtAt: statSync(graphFile(root)).mtimeMs,
		};
	} catch {
		return undefined;
	}
}

/** Keeps graphify-out/ out of git without touching the tracked ignore file. */
export function ensureExcluded(root: string): void {
	const file = join(root, GIT_DIR, "info", "exclude");
	try {
		if (!existsSync(join(root, GIT_DIR))) return;
		const current = existsSync(file) ? readFileSync(file, "utf8") : "";
		if (!current.split("\n").some((line) => line.trim().replace(/\/$/, "") === OUT)) appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${OUT}/\n`);
	} catch {
		// best effort
	}
}

export interface Run {
	code: number;
	out: string;
}

/** Runs graphify, calling `onLine` for every output line; abort kills it. */
export function runGraphify(args: string[], cwd: string, onLine?: (line: string) => void, signal?: AbortSignal, env: Record<string, string> = {}): Promise<Run> {
	return new Promise((resolve) => {
		const child = spawn("graphify", args, { cwd, env: { ...ENV, ...env }, signal });
		let out = "";
		let pending = "";
		const feed = (chunk: Buffer) => {
			const textChunk = chunk.toString();
			out += textChunk;
			pending += textChunk;
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) onLine?.(line);
		};
		child.stdout.on("data", feed);
		child.stderr.on("data", feed);
		child.on("error", (error) => resolve({ code: -1, out: `${out}${error.message}` }));
		child.on("close", (code) => resolve({ code: code ?? -1, out }));
	});
}

const clean = (raw: string) => raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
const run = (args: string[], root: string) => spawnSync("graphify", args, { cwd: root, env: ENV, encoding: "utf8", timeout: 60_000 });

type RawNode = { id: string; label?: string; source_file?: string; file_type?: string };
type RawLink = { source: string; target: string };

/** Noise: one node per external module (`ref_node_fs`...) and "code" read from data files (the `colors` key of theme JSON). */
export const isNoise = (node: RawNode) => node.id.startsWith("ref_") || (node.file_type === "code" && /\.jsonc?$/i.test(node.source_file ?? ""));

const filteredFile = (root: string) => join(root, OUT, "graph.pi.json");

/** Copy of graph.json without noise nodes and the edges that touch them; rebuilt only when graph.json is newer. */
export function filteredGraph(root: string): string | undefined {
	const source = graphFile(root);
	const target = filteredFile(root);
	try {
		if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) return target;
		const graph = JSON.parse(readFileSync(source, "utf8")) as { nodes: RawNode[]; links: RawLink[] };
		const keep = new Set(graph.nodes.filter((node) => !isNoise(node)).map((node) => node.id));
		writeFileSync(target, JSON.stringify({ ...graph, nodes: graph.nodes.filter((node) => keep.has(node.id)), links: graph.links.filter((link) => keep.has(link.source) && keep.has(link.target)) }));
		return target;
	} catch {
		return undefined;
	}
}

const answer = (args: string[], root: string): { text: string; ok: boolean } => {
	if (!readStats(root)) return { text: "Grafo non costruito: esegui /graph e scegli Build.", ok: false };
	const filtered = filteredGraph(root);
	const result = run(filtered ? [...args, "--graph", filtered] : args, root);
	const body = clean(`${result.stdout ?? ""}${result.stderr ?? ""}`);
	return { text: body || "Nessun risultato.", ok: result.status === 0 };
};

export const query = (root: string, question: string, budget = 1500) => answer(["query", question, "--budget", String(budget)], root);
export const explain = (root: string, name: string) => answer(["explain", name], root);
export const path = (root: string, from: string, to: string) => answer(["path", from, to, "--undirected"], root);

/** Most connected nodes without noise, each with its file so equal names stay apart. */
export function hubs(root: string, limit = 10): string {
	const file = filteredGraph(root);
	if (!file) return "";
	try {
		const graph = JSON.parse(readFileSync(file, "utf8")) as { nodes: RawNode[]; links: RawLink[] };
		const degree = new Map<string, number>();
		for (const link of graph.links) for (const id of [link.source, link.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		return [...degree].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, count], index) => `  ${index + 1}. ${byId.get(id)?.label ?? id} (${byId.get(id)?.source_file ?? "?"}) - ${count} collegamenti`).join("\n");
	} catch {
		return "";
	}
}

export interface GraphState {
	nodes: number;
	edges: number;
	files: number;
	communities: number;
	concepts: number;
	inferredPercent: number;
	builtAt: number;
	changed: number;
	hubs: { name: string; links: number }[];
}

/** Files edited since `builtAt`: dirty and untracked files touched after it, plus files in commits made after it. graphify-out is not counted. */
export function changedFiles(root: string, builtAt: number): string[] {
	const git = (args: string[]) => (spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000 }).stdout ?? "").split("\n").filter(Boolean);
	const touched = (file: string) => {
		try {
			return statSync(join(root, file)).mtimeMs > builtAt;
		} catch {
			return false;
		}
	};
	const files = new Set([...git(["diff", "--name-only", "HEAD"]).filter(touched), ...git(["ls-files", "--others", "--exclude-standard"]).filter(touched), ...git(["log", `--since=${new Date(builtAt).toISOString()}`, "--name-only", "--pretty=format:"])]);
	return [...files].filter((file) => !file.startsWith(`${OUT}/`)).sort();
}

export const changedSince = (root: string, builtAt: number): number => changedFiles(root, builtAt).length;

/** Files changed after the last build, checked only at startup and after a build or update (not every turn), then remembered per project. */
const freshness = new Map<string, { builtAt: number; files: string[] }>();

/** Checks the graph against the files now and remembers the result; undefined when there is no graph. */
export function checkFreshness(root: string): { builtAt: number; files: string[] } | undefined {
	const stats = readStats(root);
	if (!stats) return void freshness.delete(root);
	const value = { builtAt: stats.builtAt, files: changedFiles(root, stats.builtAt) };
	freshness.set(root, value);
	return value;
}

const known = (root: string) => freshness.get(root);

/** True when a graph exists and no file changed after its build at the last check: only then the model gets the graph. */
export const isFresh = (root: string): boolean => {
	const state = known(root);
	return state !== undefined && state.files.length === 0;
};

/** What the panel shows about the graph; undefined when it was never built. Reads graph.json, so callers cache by `builtAt`. */
export function graphState(root: string): GraphState | undefined {
	const stats = readStats(root);
	if (!stats) return undefined;
	try {
		const graph = JSON.parse(readFileSync(graphFile(root), "utf8")) as { nodes: RawNode[]; links: (RawLink & { confidence?: string })[] };
		const inferred = graph.links.filter((link) => link.confidence && link.confidence !== "EXTRACTED").length;
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		const degree = new Map<string, number>();
		for (const link of graph.links) {
			if (isNoise(byId.get(link.source) ?? { id: link.source }) || isNoise(byId.get(link.target) ?? { id: link.target })) continue;
			for (const id of [link.source, link.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
		}
		const hubs = [...degree]
			.filter(([id]) => byId.get(id)?.file_type === "code")
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([id, links]) => ({ name: byId.get(id)?.source_file?.split("/").pop() ?? byId.get(id)?.label ?? id, links }));
		return { ...stats, concepts: graph.nodes.filter((node) => node.file_type === "concept").length, inferredPercent: graph.links.length ? Math.round((inferred / graph.links.length) * 100) : 0, changed: known(root)?.files.length ?? 0, hubs };
	} catch {
		return undefined;
	}
}

/** Short text for the system prompt: size of the graph and its most connected nodes. Max ~1400 characters. */
export function summary(root: string): string | undefined {
	const stats = readStats(root);
	if (!stats) return undefined;
	return `${SUMMARY_MARKER}\nGrafo del progetto: ${stats.files} file, ${stats.nodes} nodi, ${stats.edges} archi, ${stats.communities} gruppi. Per capire dove sta una cosa o cosa dipende da cosa usa i tool graph_query, graph_explain, graph_path prima di cercare file per file.\nNodi più connessi:\n${hubs(root)}`.slice(0, 1400);
}

const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], details: undefined, ...(isError ? { isError } : {}) });
const MENU = ["Stato del grafo", "Build / Aggiorna (Graphify, AST locale, 0 token)", "Nodi più connessi", "Cerca…", "Spiega un file o simbolo…", "Percorso tra due nodi…", "Report (GRAPH_REPORT.md)", "Semantica (Claude Code, usa il piano)", "Esci"];

export function registerGraphify(pi: ExtensionAPI, rootOf: (cwd: string) => string): void {
	const cache = new Map<string, { builtAt: number; text: string | undefined }>();
	let running = false;

	/** The graph tools are declared to the model only while the graph is fresh; a stale or missing graph is left out entirely. */
	const GRAPH_TOOLS = ["graph_query", "graph_explain", "graph_path"];
	const syncTools = (usable: boolean) => {
		try {
			const active = pi.getActiveTools();
			const others = active.filter((name) => !GRAPH_TOOLS.includes(name));
			const next = usable ? [...others, ...GRAPH_TOOLS] : others;
			if (next.length !== active.length || next.some((name, index) => name !== active[index])) pi.setActiveTools(next);
		} catch {
			// tools are a courtesy; never break startup for them
		}
	};

	/** Tells the side panel what the graph holds. `check` re-reads the files (startup, after a build); otherwise the last result is reused. */
	let panelCache: { builtAt: number; state: GraphState } | undefined;
	const announce = (cwd: string, check = false) => {
		const root = rootOf(cwd);
		const checked = check ? checkFreshness(root) : (known(root) ?? checkFreshness(root));
		if (!checked) return void pi.events.emit("graph:state", undefined);
		if (check || panelCache?.builtAt !== checked.builtAt) {
			const state = graphState(root);
			if (!state) return;
			panelCache = { builtAt: checked.builtAt, state };
		}
		pi.events.emit("graph:state", panelCache?.state);
		syncTools(isFresh(root));
	};

	/** The prompt text, built once per build from the decision saved at startup or after a build: no file is read on a normal turn. */
	const summaryOf = (root: string) => {
		const state = known(root);
		if (!state) return undefined;
		const hit = cache.get(root);
		if (hit?.builtAt === state.builtAt) return hit.text;
		const value = summary(root);
		cache.set(root, { builtAt: state.builtAt, text: value });
		return value;
	};

	const show = (title: string, body: string) => pi.sendMessage({ customType: "graph-report", content: `${title}\n${body}`, display: true });

	/** Files under a folder, recursively; 0 when it does not exist. Used to watch graphify's cache grow. */
	const countFiles = (dir: string): number => {
		try {
			return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1), 0);
		} catch {
			return 0;
		}
	};

	/** Runs `work` while a fixed modal shows progress and the log; the modal stays until the user closes it. */
	const job = async (ctx: ExtensionContext, title: string, work: (modal: JobModal) => Promise<string>): Promise<string> => {
		const modal = new JobModal(title);
		const shown = ctx.hasUI ? ctx.ui.custom<void>((tui, _theme, _keys, done) => (modal.attach(() => tui.requestRender(), () => done()), modal), { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } }) : Promise.resolve();
		const tick = setInterval(() => {
			modal.set({ now: Date.now() });
			if (ctx.hasUI) ctx.ui.setStatus("graph", `GRAPH ${modal.progress.total ? Math.round((modal.progress.done / modal.progress.total) * 100) : 0}%`);
		}, 500);
		let message: string;
		try {
			message = await work(modal);
		} catch (error) {
			message = `Errore: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			clearInterval(tick);
			if (ctx.hasUI) ctx.ui.setStatus("graph", undefined);
		}
		try {
			announce(ctx.cwd, true);
		} catch {
			// best effort
		}
		modal.finish(message);
		await shown;
		return message;
	};

	/** `graphify update`: local AST extraction, no model. Progress comes from its own output lines. */
	const build = (ctx: ExtensionContext): Promise<string> =>
		job(ctx, "Graphify: build (AST locale, 0 token)", async (modal) => {
			const root = rootOf(ctx.cwd);
			ensureExcluded(root);
			modal.log(`Cartella: ${root}`);
			const result = await runGraphify(
				["update", root],
				root,
				(line) => {
					modal.log(clean(line));
					const found = parseProgress(line);
					if (found) modal.set({ phase: "estrazione AST", ...found });
					else if (/Rebuilt|updated/i.test(line)) modal.set({ phase: "comunità, report e HTML", done: modal.progress.total });
				},
				modal.abort.signal,
			);
			if (modal.abort.signal.aborted) return "Build annullata.";
			const stats = readStats(root);
			if (result.code !== 0 || !stats) return `Graphify non è riuscito (codice ${result.code}):\n${clean(result.out).split("\n").slice(-6).join("\n")}`;
			return `Fatto in ${duration(Date.now() - modal.progress.startedAt)}: ${stats.nodes} nodi, ${stats.edges} archi, ${stats.communities} gruppi, ${stats.files} file. Token usati: 0.\nOutput in ${OUT}/ (graph.json, GRAPH_REPORT.md, graph.html).`;
		});

	/** `graphify extract --backend claude-cli`: AST plus documents read by Claude Code (Haiku by default, on the plan). */
	const semantic = async (ctx: ExtensionContext): Promise<string> => {
		if (ctx.hasUI && !(await ctx.ui.confirm("Semantica con Claude Code", "Graphify fa leggere a Claude Code (Haiku) i documenti non ancora in cache: concetti e relazioni. Usa il tuo piano (costo in dollari 0) ma consuma quota e può durare minuti: misurato su 2 documenti piccoli: circa 80.000 token in ingresso, 18 s. Esc annulla. Procedere?"))) return "Semantica non avviata: hai risposto No (o Esc) alla conferma.";
		return job(ctx, "Graphify + Claude Code: semantica", async (modal) => {
			const root = rootOf(ctx.cwd);
			ensureExcluded(root);
			const model = process.env.PI_GRAPH_MODEL ?? "haiku";
			const cacheDir = join(root, OUT, "cache");
			const before = countFiles(cacheDir);
			modal.log(`Modello: ${model} (piano Claude Code). Cache iniziale: ${before} file.`);
			modal.extra = `Cache di graphify: ${before} file (+0 in questa esecuzione)`;
			const watch = setInterval(() => {
				const now = countFiles(cacheDir);
				modal.extra = `Cache di graphify: ${now} file (+${now - before} in questa esecuzione)`;
			}, 1000);
			try {
				const result = await runGraphify(
					["extract", root, "--backend", "claude-cli", "--max-concurrency", "1"],
					root,
					(line) => {
						modal.log(clean(line).replace("[graphify extract] ", ""));
						const chunk = /chunk (\d+)\/(\d+)/.exec(line);
						if (chunk) modal.set({ phase: "lettura dei documenti", done: Number(chunk[1]), total: Number(chunk[2]) });
						else if (/AST extraction/.test(line)) modal.set({ phase: "estrazione AST" });
						else if (/semantic extraction on \d+ files/.test(line)) modal.set({ phase: "lettura dei documenti (la barra avanza a fine blocco)", done: 0, total: 1 });
						const tokens = /tokens: ([\d,]+) in \/ ([\d,]+) out/.exec(line);
						if (tokens) modal.set({ input: Number(tokens[1].replace(/,/g, "")), output: Number(tokens[2].replace(/,/g, "")) });
					},
					modal.abort.signal,
					{ GRAPHIFY_CLAUDE_CLI_MODEL: model },
				);
				if (modal.abort.signal.aborted) return "Semantica interrotta: Esc premuto mentre girava.";
				if (result.code !== 0) return `Graphify non è riuscito (codice ${result.code}):\n${clean(result.out).split("\n").slice(-6).join("\n")}`;
				modal.set({ phase: "report e comunità", done: modal.progress.total });
				await runGraphify(["cluster-only", root], root, (line) => modal.log(clean(line)), modal.abort.signal);
				const stats = readStats(root);
				return `Fatto in ${duration(Date.now() - modal.progress.startedAt)}${stats ? `: ${stats.nodes} nodi, ${stats.edges} archi, ${stats.communities} gruppi` : ""}.\nToken: ${modal.progress.input.toLocaleString()} in, ${modal.progress.output.toLocaleString()} out (modello ${model}, piano Claude Code, costo $0).`;
			} finally {
				clearInterval(watch);
			}
		});
	};

	const status = (root: string) => {
		const stats = readStats(root);
		return stats ? `Graphify: ${stats.files} file, ${stats.nodes} nodi, ${stats.edges} archi, ${stats.communities} gruppi. Costruito il ${new Date(stats.builtAt).toLocaleString()}. Cartella ${OUT}/ (usa "Build / Aggiorna" per rinfrescare).` : "Grafo non costruito: scegli Build / Aggiorna.";
	};

	const choose = async (choice: string, ctx: ExtensionContext): Promise<void> => {
		const root = rootOf(ctx.cwd);
		if (choice.startsWith("Stato")) return show("Stato del grafo", status(root));
		if (choice.startsWith("Build")) return show("Build Graphify", await build(ctx));
		if (choice.startsWith("Semantica")) return show("Semantica Graphify + Claude Code", await semantic(ctx));
		if (choice.startsWith("Nodi")) return show("Nodi più connessi (senza moduli esterni e file JSON)", hubs(root, 15) || "Grafo non costruito.");
		if (choice.startsWith("Report")) {
			const file = join(root, OUT, "GRAPH_REPORT.md");
			return show("Report", existsSync(file) ? readFileSync(file, "utf8").slice(0, 3500) : "Nessun report: esegui la build.");
		}
		if (choice.startsWith("Cerca")) {
			const value = (await ctx.ui.input("Cerca nel grafo", "domanda o parole chiave"))?.trim();
			return value ? show(`Cerca: ${value}`, query(root, value).text) : undefined;
		}
		if (choice.startsWith("Spiega")) {
			const value = (await ctx.ui.input("Spiega", "nome del file o del simbolo"))?.trim();
			return value ? show(`Spiega: ${value}`, explain(root, value).text) : undefined;
		}
		if (choice.startsWith("Percorso")) {
			const from = (await ctx.ui.input("Percorso: da", "file o simbolo"))?.trim();
			const to = from ? (await ctx.ui.input("Percorso: a", "file o simbolo"))?.trim() : undefined;
			return from && to ? show(`Percorso: ${from} → ${to}`, path(root, from, to).text) : undefined;
		}
	};

	const USAGE = "Uso: /graph (menu) | build | semantic | status | query <testo> | explain <nodo> | path <da> <a>";
	pi.registerCommand("graph", {
		description: "Grafo del progetto (Graphify): menu con build, stato, nodi centrali, ricerca. Anche /graph build | status | query | explain | path",
		handler: async (args, ctx) => {
			if (running) return void ctx.ui.notify("Un'operazione del grafo è già in corso.", "warning");
			const [command = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const root = rootOf(ctx.cwd);
			running = true;
			try {
				if (!command) {
					if (!ctx.hasUI) return void ctx.ui.notify(USAGE, "info");
					for (;;) {
						const stats = readStats(root);
						const choice = await ctx.ui.select(stats ? `Grafo del progetto (Graphify) — ${stats.nodes} nodi, ${stats.edges} archi, ${stats.communities} gruppi` : "Grafo del progetto (Graphify) — non ancora costruito", MENU);
						if (!choice || choice === "Esci") return;
						await choose(choice, ctx);
					}
				}
				if (command === "build" || command === "update") return show("Build Graphify", await build(ctx));
				if (command === "status") return show("Stato del grafo", status(root));
				if (command === "semantic") return show("Semantica Graphify + Claude Code", await semantic(ctx));
				if (command === "query" && rest.length) return show(`Cerca: ${rest.join(" ")}`, query(root, rest.join(" ")).text);
				if (command === "explain" && rest.length) return show(`Spiega: ${rest.join(" ")}`, explain(root, rest.join(" ")).text);
				if (command === "path" && rest.length === 2) return show(`Percorso: ${rest[0]} → ${rest[1]}`, path(root, rest[0], rest[1]).text);
				ctx.ui.notify(USAGE, "info");
			} finally {
				running = false;
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		try {
			announce(ctx.cwd, true);
		} catch {
			// best effort
		}
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (event.systemPrompt.includes(SUMMARY_MARKER)) return;
		const root = rootOf(ctx.cwd);
		if (!isFresh(root)) return;
		const value = summaryOf(root);
		if (value) return { systemPrompt: `${event.systemPrompt}\n\n${value}` };
	});

	const tool = (name: string, label: string, description: string, properties: Record<string, unknown>, required: string[], reply: (root: string, params: Record<string, string>) => { text: string; ok: boolean }) =>
		pi.registerTool({
			name,
			label,
			description,
			parameters: { type: "object", properties, required } as never,
			async execute(_id, raw, _signal, _update, ctx) {
				const result = reply(rootOf(ctx.cwd), raw as Record<string, string>);
				return text(result.text, !result.ok);
			},
		});

	tool("graph_query", "Graph query", "Ask the project graph (Graphify) a question or keywords: returns the connected files, functions and concepts. Prefer over many greps. Needs /graph build.", { query: { type: "string" }, budget: { type: "number", description: "max tokens in the answer (default 1500)" } }, ["query"], (root, params) => query(root, params.query, Number(params.budget) || 1500));
	tool("graph_explain", "Graph explain", "What a file or symbol is linked to in the project graph: imports, calls, who uses it. Use before changing a file to see what depends on it.", { node: { type: "string", description: "file name or symbol name" } }, ["node"], (root, params) => explain(root, params.node));
	tool("graph_path", "Graph path", "Shortest chain of links between two files or symbols in the project graph.", { from: { type: "string" }, to: { type: "string" } }, ["from", "to"], (root, params) => path(root, params.from, params.to));
}
