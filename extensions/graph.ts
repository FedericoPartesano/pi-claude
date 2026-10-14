/**
 * /graph: graph of the whole project (files, symbols, imports, tests, docs), built once and then updated on the files
 * that changed. Saved in .pi/graph/ (not tracked by git). The model gets a short summary in the system prompt and
 * three tools (graph_query, graph_explain, graph_path) to ask the graph instead of searching file after file.
 * PI_GRAPH=0 turns it off.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Analysis, analyze, findNode, shortestPath } from "./graph/analyze.ts";
import { GRAPH_VERSION, type Graph, buildGraph, listProjectFiles, loadProjectConfig, projectRoot, scanProject, staleCount } from "./graph/engine.ts";
import { SUMMARY_MARKER, formatExplain, formatPath, formatSearch, summaryText } from "./graph/format.ts";

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

const USAGE = "Uso: /graph build | update | status | query <testo> | explain <file o simbolo> | path <da> <a>";

export default function (pi: ExtensionAPI) {
	if (process.env.PI_GRAPH === "0") return;
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

	const build = (ctx: ExtensionContext, full: boolean) => {
		const started = Date.now();
		const root = rootOf(ctx.cwd);
		const listed = listProjectFiles(root);
		const inputs = scanProject(root, listed);
		if (!inputs.length) return "Nessun file da indicizzare (serve un repository git).";
		const { graph, stats } = buildGraph(inputs, full ? undefined : loadGraph(root), loadProjectConfig(root, listed));
		saveGraph(rootOf(ctx.cwd), graph);
		const analysis = analyze(graph);
		cached = { cwd: rootOf(ctx.cwd), builtAt: graph.builtAt, graph, analysis, summary: summaryText(graph, analysis) };
		const groups = analysis.communities.filter((community) => community.files.length >= 3).length;
		return `Grafo ${full ? "costruito" : "aggiornato"} in ${Date.now() - started} ms: ${stats.files} file (${stats.processed} rielaborati, ${stats.reused} riusati, ${stats.removed} rimossi), ${stats.nodes} nodi, ${stats.edges} archi, ${groups} gruppi. Salvato in ${DIR}/${FILE}.`;
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

	pi.registerCommand("graph", {
		description: "Grafo del progetto: /graph build | update | status | query | explain | path",
		handler: async (args, ctx) => {
			const [command = "", ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const reply = (message: string) => ctx.ui.notify(message, "info");
			if (command === "build" || command === "update") return reply(build(ctx, command === "build"));
			if (command === "status") {
				const state = current(rootOf(ctx.cwd));
				if (!state) return reply(missing);
				const stale = staleCount(scanProject(rootOf(ctx.cwd)), state.graph);
				return reply(`Grafo: ${Object.keys(state.graph.files).length} file, ${state.graph.nodes.length} nodi, ${state.graph.edges.length} archi, costruito ${new Date(state.graph.builtAt).toLocaleString()}. ${stale ? `Indietro di ${stale} file: /graph update.` : "Aggiornato."}`);
			}
			const state = current(rootOf(ctx.cwd));
			if (["query", "explain", "path"].includes(command) && !state) return reply(missing);
			if (command === "query" && rest.length) return reply(formatSearch(state!.graph, state!.analysis, rest.join(" ")));
			if (command === "explain" && rest.length) {
				const node = findNode(state!.graph, rest.join(" "), state!.analysis);
				return reply(node ? formatExplain(state!.graph, state!.analysis, node) : `Nessun nodo per "${rest.join(" ")}".`);
			}
			if (command === "path" && rest.length === 2) {
				const [from, to] = rest.map((name) => findNode(state!.graph, name, state!.analysis));
				return reply(from && to ? formatPath(shortestPath(state!.graph, from.id, to.id), from.label, to.label) : "Nodo non trovato.");
			}
			reply(USAGE);
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
