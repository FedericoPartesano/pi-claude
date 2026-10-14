/**
 * /graph: graph of the whole project (files, symbols, imports, tests, docs), built once and then updated on the files
 * that changed. Saved in .pi/graph/ (not tracked by git). The model gets a short summary in the system prompt and
 * three tools (graph_query, graph_explain, graph_path) to ask the graph instead of searching file after file.
 * Engine: Graphify when installed (graph/graphify.ts); PI_GRAPH_ENGINE=custom uses the engine in graph/. PI_GRAPH=0 turns it off.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { graphifyReady, registerGraphify } from "./graph/graphify.ts";
import { type Analysis, analyze, findNode, shortestPath } from "./graph/analyze.ts";
import { type Progress, compact, duration, progressLines } from "./graph/progress.ts";
import { SEMANTIC_SYSTEM, estimateTokens, parseSemantic, semanticCandidates, semanticPrompt } from "./graph/semantic.ts";
import { GRAPH_VERSION, type Graph, buildGraph, deriveGraph, listProjectFiles, loadProjectConfig, projectRoot, scanProject, staleCount } from "./graph/engine.ts";
import { SUMMARY_MARKER, formatCentral, formatCommunities, formatConcepts, formatExplain, formatPath, formatSearch, formatStatus, formatSurprising, summaryText } from "./graph/format.ts";

const DIR = ".pi/graph";
const FILE = "graph.json";
const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], details: undefined, ...(isError ? { isError } : {}) });

export const graphPath = (cwd: string) => join(cwd, DIR, FILE);

export function loadGraph(cwd: string): Graph | undefined {
	try {
		const graph = JSON.parse(readFileSync(graphPath(cwd), "utf8")) as Graph;
		return graph.version === GRAPH_VERSION ? graph : undefined;
	} catch {
		return undefined;
	}
}

export function saveGraph(cwd: string, graph: Graph): void {
	mkdirSync(join(cwd, DIR), { recursive: true });
	writeFileSync(join(cwd, DIR, ".gitignore"), "*\n");
	writeFileSync(graphPath(cwd), JSON.stringify(graph));
}

const roots = new Map<string, string>();
/** Git root of the folder pi runs in, so the graph covers the whole repository and lives in one place. */
const rootOf = (cwd: string) => roots.get(cwd) ?? (roots.set(cwd, projectRoot(cwd)), roots.get(cwd)!);

const USAGE = "Uso: /graph (menu) | build | update | semantic | status | query <testo> | explain <file o simbolo> | path <da> <a>";

export default function (pi: ExtensionAPI) {
	if (process.env.PI_GRAPH === "0") return;
	// Default engine: Graphify (tree-sitter), when installed. PI_GRAPH_ENGINE=custom keeps the engine written in this repo.
	if (process.env.PI_GRAPH_ENGINE !== "custom" && graphifyReady()) return registerGraphify(pi, rootOf);
	let cached: { cwd: string; builtAt: number; graph: Graph; analysis: Analysis; summary: string } | undefined;

	/** The graph on disk with its analysis, computed once per version of the file. */
	const current = (cwd: string) => {
		const graph = loadGraph(cwd);
		if (!graph) return undefined;
		if (!cached || cached.cwd !== cwd || cached.builtAt !== graph.builtAt) {
			const analysis = analyze(graph);
			cached = { cwd, builtAt: graph.builtAt, graph, analysis, summary: summaryText(graph, analysis) };
		}
		return cached;
	};

	const wait = () => new Promise<void>((resolve) => setImmediate(resolve));
	let running = false;

	/** The progress panel above the editor; undefined clears it. */
	const panel = (ctx: ExtensionContext, progress?: Progress, cancellable = false) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("graph", progress ? progressLines({ ...progress, now: Date.now() }, cancellable) : undefined);
		ctx.ui.setStatus("graph", progress ? `GRAPH ${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` : undefined);
	};

	/** Static build in visible phases (scan → extract → analyse); no model, no tokens. */
	const build = async (ctx: ExtensionContext, full: boolean): Promise<string> => {
		const root = rootOf(ctx.cwd);
		const base: Progress = { title: full ? "Build veloce" : "Aggiornamento", phase: "", done: 0, total: 3, input: 0, output: 0, cost: 0, startedAt: Date.now(), now: 0 };
		try {
			panel(ctx, { ...base, phase: "scansione dei file" });
			await wait();
			const listed = listProjectFiles(root);
			const inputs = scanProject(root, listed);
			if (!inputs.length) return "Nessun file da indicizzare (serve un repository git).";
			panel(ctx, { ...base, phase: `estrazione di ${inputs.length} file`, done: 1, current: "simboli, import, collegamenti" });
			await wait();
			const { graph, stats } = buildGraph(inputs, full ? undefined : loadGraph(root), loadProjectConfig(root, listed));
			panel(ctx, { ...base, phase: "analisi e salvataggio", done: 2, current: "gruppi e file centrali" });
			await wait();
			saveGraph(root, graph);
			const analysis = analyze(graph);
			cached = { cwd: root, builtAt: graph.builtAt, graph, analysis, summary: summaryText(graph, analysis) };
			const groups = analysis.communities.filter((community) => community.files.length >= 3).length;
			return `Grafo ${full ? "costruito" : "aggiornato"} in ${Date.now() - base.startedAt} ms: ${stats.files} file (${stats.processed} rielaborati, ${stats.reused} riusati, ${stats.removed} rimossi), ${stats.nodes} nodi, ${stats.edges} archi, ${groups} gruppi. Token usati: 0. Salvato in ${DIR}/${FILE}.`;
		} finally {
			panel(ctx);
		}
	};

	/** One document through the small model; the answer and its real usage. */
	const readDocument = async (ctx: ExtensionContext, path: string, text: string, known: string[], signal: AbortSignal) => {
		const model = ctx.modelRegistry.find("claude-code", process.env.PI_GRAPH_MODEL ?? "haiku");
		if (!model) throw new Error("modello non disponibile");
		const stream = ctx.modelRegistry.streamSimple(model, { systemPrompt: SEMANTIC_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: semanticPrompt(path, text, known) }], timestamp: Date.now() }] } as never, { signal } as never);
		for await (const _event of stream) {
			// drain: the final message has the answer and the usage
		}
		const message = await stream.result();
		if (message.stopReason === "error") throw new Error("chiamata fallita");
		const usage = ((message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number | { total?: number } } }).usage ?? {});
		const cost = typeof usage.cost === "number" ? usage.cost : (usage.cost?.total ?? 0);
		return { text: message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(""), input: (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0), output: usage.output ?? 0, cost };
	};

	/** Semantic pass on the documents without a valid reading: sequential, cancellable with Esc, saved after every document. */
	const semantic = async (ctx: ExtensionContext): Promise<string> => {
		const root = rootOf(ctx.cwd);
		const graph = loadGraph(root);
		if (!graph) return missing;
		const todo = semanticCandidates(graph);
		if (!todo.length) return `Passo semantico: nessun documento da leggere (${Object.keys(graph.semantic ?? {}).length} già letti, invariati).`;
		const estimate = estimateTokens(graph, todo);
		if (ctx.hasUI && !(await ctx.ui.confirm("Passo semantico con Haiku", `${todo.length} documenti, circa ${compact(estimate.input)} token in ingresso e ${compact(estimate.output)} in uscita (stima). Sequenziale, annullabile con Esc; i già letti si saltano. Procedere?`))) return "Passo semantico annullato.";
		const known = Object.keys(graph.files).filter((path) => graph.files[path].kind === "code");
		const knownSet = new Set(Object.keys(graph.files));
		const config = loadProjectConfig(root);
		const abort = new AbortController();
		const stop = ctx.hasUI ? ctx.ui.onTerminalInput((data) => (data === "\x1b" ? (abort.abort(), { consume: true }) : undefined)) : () => {};
		const progress: Progress = { title: "Build semantica", phase: "lettura dei documenti con Haiku", done: 0, total: todo.length, input: 0, output: 0, cost: 0, startedAt: Date.now(), now: 0, failed: 0 };
		let last = "";
		try {
			for (const path of todo) {
				if (abort.signal.aborted) break;
				panel(ctx, { ...progress, current: path }, true);
				try {
					const answer = await readDocument(ctx, path, readFileSync(join(root, path), "utf8"), known, abort.signal);
					progress.input += answer.input;
					progress.output += answer.output;
					progress.cost += answer.cost;
					const record = parseSemantic(answer.text, graph.files[path].hash, knownSet);
					if (record) {
						graph.semantic = { ...(graph.semantic ?? {}), [path]: record };
						const { nodes, edges } = deriveGraph(graph.files, config, graph.semantic);
						Object.assign(graph, { nodes, edges, builtAt: Date.now() });
						saveGraph(root, graph);
					} else progress.failed = (progress.failed ?? 0) + 1;
				} catch (error) {
					if (abort.signal.aborted) break;
					progress.failed = (progress.failed ?? 0) + 1;
					last = error instanceof Error ? error.message : String(error);
				}
				progress.done++;
			}
		} finally {
			stop();
			panel(ctx);
		}
		const analysis = analyze(graph);
		cached = { cwd: root, builtAt: graph.builtAt, graph, analysis, summary: summaryText(graph, analysis) };
		const concepts = graph.nodes.filter((node) => node.kind === "concept").length;
		return `${abort.signal.aborted ? "Annullato" : "Fatto"}: ${progress.done}/${todo.length} documenti letti, ${progress.failed} non letti${last ? ` (ultimo errore: ${last})` : ""}, ${concepts} concetti nel grafo. Token usati: ${compact(progress.input)} in, ${compact(progress.output)} out, costo $${progress.cost.toFixed(4)} in ${duration(Date.now() - progress.startedAt)}.`;
	};

	const missing = "Grafo non costruito: esegui /graph build.";

	pi.on("before_agent_start", (event, ctx) => {
		if (event.systemPrompt.includes(SUMMARY_MARKER)) return;
		const state = current(rootOf(ctx.cwd));
		if (state) return { systemPrompt: `${event.systemPrompt}\n\n${state.summary}` };
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || !existsSync(graphPath(rootOf(ctx.cwd)))) return;
		const graph = loadGraph(rootOf(ctx.cwd));
		const stale = graph ? staleCount(scanProject(rootOf(ctx.cwd)), graph) : 0;
		if (stale) ctx.ui.notify(`Il grafo del progetto è indietro di ${stale} file: /graph update.`, "info");
	});

	/** Shows a result in the conversation (kept), not in a notice that disappears. */
	const show = (title: string, body: string) => pi.sendMessage({ customType: "graph-report", content: `${title}\n${body}`, display: true });

	const MENU = ["Stato del grafo", "Build veloce (statica, 0 token)", "Aggiorna (solo file cambiati)", "Build + semantica (Haiku, usa token)", "Gruppi", "File centrali", "Connessioni sorprendenti", "Concetti", "Cerca…", "Spiega un file o simbolo…", "Esci"];

	const stateOf = (ctx: ExtensionContext) => current(rootOf(ctx.cwd));

	const run = async (choice: string, ctx: ExtensionContext): Promise<void> => {
		if (choice.startsWith("Build veloce")) return show("Build veloce", await build(ctx, true));
		if (choice.startsWith("Aggiorna")) return show("Aggiornamento", await build(ctx, false));
		if (choice.startsWith("Build + semantica")) {
			const first = await build(ctx, false);
			return show("Build + semantica", `${first}\n${await semantic(ctx)}`);
		}
		const state = stateOf(ctx);
		if (!state) return show("Grafo", missing);
		if (choice.startsWith("Stato")) return show("Stato del grafo", formatStatus(state.graph, state.analysis, staleCount(scanProject(rootOf(ctx.cwd)), state.graph)));
		if (choice === "Gruppi") return show("Gruppi", formatCommunities(state.analysis));
		if (choice === "File centrali") return show("File centrali", formatCentral(state.analysis));
		if (choice.startsWith("Connessioni")) return show("Connessioni tra gruppi", formatSurprising(state.analysis));
		if (choice === "Concetti") return show("Concetti", formatConcepts(state.graph));
		if (choice.startsWith("Cerca")) {
			const query = await ctx.ui.input("Cerca nel grafo", "parole: nome di un file, simbolo, concetto");
			return query?.trim() ? show(`Cerca: ${query}`, formatSearch(state.graph, state.analysis, query)) : undefined;
		}
		if (choice.startsWith("Spiega")) {
			const name = await ctx.ui.input("Spiega", "percorso del file o nome del simbolo");
			const node = name?.trim() ? findNode(state.graph, name.trim(), state.analysis) : undefined;
			return name?.trim() ? show(`Spiega: ${name}`, node ? formatExplain(state.graph, state.analysis, node) : "Nessun nodo trovato.") : undefined;
		}
	};

	pi.registerCommand("graph", {
		description: "Grafo del progetto: menu (build, stato, gruppi, ricerca). Anche /graph build | update | semantic | status | query | explain | path",
		handler: async (args, ctx) => {
			const [command = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
			if (running) return void ctx.ui.notify("Un'operazione del grafo è già in corso.", "warning");
			running = true;
			try {
				if (!command) {
					if (!ctx.hasUI) return void ctx.ui.notify(USAGE, "info");
					for (;;) {
						const state = stateOf(ctx);
						const title = state ? `Grafo del progetto — ${Object.keys(state.graph.files).length} file, ${state.graph.nodes.length} nodi, ${state.graph.edges.length} archi` : "Grafo del progetto — non ancora costruito";
						const choice = await ctx.ui.select(title, MENU);
						if (!choice || choice === "Esci") return;
						await run(choice, ctx);
					}
				}
				if (command === "build") return show("Build veloce", await build(ctx, true));
				if (command === "update") return show("Aggiornamento", await build(ctx, false));
				if (command === "semantic") return show("Build semantica", await semantic(ctx));
				if (command === "status") return await run("Stato", ctx);
				const state = stateOf(ctx);
				if (["query", "explain", "path"].includes(command) && !state) return show("Grafo", missing);
				if (command === "query" && rest.length) return show(`Cerca: ${rest.join(" ")}`, formatSearch(state!.graph, state!.analysis, rest.join(" ")));
				if (command === "explain" && rest.length) {
					const node = findNode(state!.graph, rest.join(" "), state!.analysis);
					return show(`Spiega: ${rest.join(" ")}`, node ? formatExplain(state!.graph, state!.analysis, node) : "Nessun nodo trovato.");
				}
				if (command === "path" && rest.length === 2) {
					const [from, to] = rest.map((name) => findNode(state!.graph, name, state!.analysis));
					return show("Percorso", from && to ? formatPath(shortestPath(state!.graph, from.id, to.id), from.label, to.label) : "Nodo non trovato.");
				}
				ctx.ui.notify(USAGE, "info");
			} finally {
				running = false;
			}
		},
	});

	pi.registerTool({
		name: "graph_query",
		label: "Graph query",
		description: "Search the project graph by words (file names, symbols, concepts in names): where something is and which group it belongs to. Prefer over many greps. Needs /graph build.",
		parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } as never,
		async execute(_id, raw, _signal, _update, ctx) {
			const params = raw as { query: string; limit?: number };
			const state = current(rootOf(ctx.cwd));
			return state ? text(formatSearch(state.graph, state.analysis, params.query, Math.min(30, params.limit ?? 10))) : text(missing, true);
		},
	});

	pi.registerTool({
		name: "graph_explain",
		label: "Graph explain",
		description: "What a file or symbol is linked to in the project graph: imports, who imports it, tests, docs, references (marked (?) when inferred). Use before changing or reading a file to see what depends on it.",
		parameters: { type: "object", properties: { node: { type: "string", description: "file path or symbol name" } }, required: ["node"] } as never,
		async execute(_id, raw, _signal, _update, ctx) {
			const params = raw as { node: string };
			const state = current(rootOf(ctx.cwd));
			if (!state) return text(missing, true);
			const node = findNode(state.graph, params.node, state.analysis);
			return node ? text(formatExplain(state.graph, state.analysis, node)) : text(`Nessun nodo per "${params.node}".`, true);
		},
	});

	pi.registerTool({
		name: "graph_path",
		label: "Graph path",
		description: "Shortest chain of links between two files or symbols in the project graph: how two parts of the code are connected.",
		parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } as never,
		async execute(_id, raw, _signal, _update, ctx) {
			const params = raw as { from: string; to: string };
			const state = current(rootOf(ctx.cwd));
			if (!state) return text(missing, true);
			const from = findNode(state.graph, params.from, state.analysis);
			const to = findNode(state.graph, params.to, state.analysis);
			if (!from || !to) return text(`Nodo non trovato: ${!from ? params.from : params.to}.`, true);
			return text(formatPath(shortestPath(state.graph, from.id, to.id), from.label, to.label));
		},
	});
}
