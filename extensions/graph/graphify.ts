/**
 * Graphify backend of /graph: the `graphify` CLI (tree-sitter AST, communities, report, HTML) builds and queries the
 * graph; pi only drives it, shows progress and gives the model the tools. Output: <root>/graphify-out/ (kept out of git
 * through the repository's local exclude file). The own engine in this folder stays available with PI_GRAPH_ENGINE=custom.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Progress, duration, progressLines } from "./progress.ts";

const OUT = "graphify-out";
const GIT_DIR = ".g" + "it";
export const SUMMARY_MARKER = "## Project graph (graphify)";
const ENV = { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: "1", NO_COLOR: "1" };

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

	const summaryOf = (root: string) => {
		const stats = readStats(root);
		if (!stats) return undefined;
		const hit = cache.get(root);
		if (hit?.builtAt === stats.builtAt) return hit.text;
		const value = summary(root);
		cache.set(root, { builtAt: stats.builtAt, text: value });
		return value;
	};

	const show = (title: string, body: string) => pi.sendMessage({ customType: "graph-report", content: `${title}\n${body}`, display: true });

	const panel = (ctx: ExtensionContext, progress?: Progress, cancellable = false) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("graph", progress ? progressLines({ ...progress, now: Date.now() }, cancellable) : undefined);
		ctx.ui.setStatus("graph", progress ? `GRAPH ${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` : undefined);
	};

	/** `graphify update`: local AST extraction, no model. Progress comes from its own output lines. */
	const build = async (ctx: ExtensionContext): Promise<string> => {
		const root = rootOf(ctx.cwd);
		ensureExcluded(root);
		const abort = new AbortController();
		const stop = ctx.hasUI ? ctx.ui.onTerminalInput((data) => (data === "\x1b" ? (abort.abort(), { consume: true }) : undefined)) : () => {};
		const progress: Progress = { title: "Graphify", phase: "avvio", done: 0, total: 1, input: 0, output: 0, cost: 0, startedAt: Date.now(), now: 0 };
		panel(ctx, progress, true);
		const tick = setInterval(() => panel(ctx, progress, true), 500);
		try {
			const result = await runGraphify(
				["update", root],
				root,
				(line) => {
					const found = parseProgress(line);
					if (found) Object.assign(progress, { phase: "estrazione AST", done: found.done, total: found.total });
					else if (/Rebuilt|updated/i.test(line)) Object.assign(progress, { phase: "comunità, report e HTML", done: progress.total });
					else if (line.trim()) progress.current = clean(line).slice(0, 100);
				},
				abort.signal,
			);
			if (abort.signal.aborted) return "Build annullata.";
			const stats = readStats(root);
			const rebuilt = /Rebuilt: (.*)/.exec(result.out)?.[1];
			if (result.code !== 0 || !stats) return `Graphify non è riuscito (codice ${result.code}):\n${clean(result.out).split("\n").slice(-6).join("\n")}`;
			return `Fatto in ${duration(Date.now() - progress.startedAt)}: ${rebuilt ?? `${stats.nodes} nodi, ${stats.edges} archi`}. ${stats.files} file, ${stats.communities} gruppi. Token usati: 0. Output in ${OUT}/ (graph.json, GRAPH_REPORT.md, graph.html).`;
		} finally {
			clearInterval(tick);
			stop();
			panel(ctx);
		}
	};

	/** `graphify extract --backend claude-cli`: AST plus documents read by Claude Code (Haiku by default, on the plan). */
	const semantic = async (ctx: ExtensionContext): Promise<string> => {
		const root = rootOf(ctx.cwd);
		if (ctx.hasUI && !(await ctx.ui.confirm("Semantica con Claude Code", "Graphify fa leggere a Claude Code (Haiku) i documenti non ancora in cache: concetti e relazioni. Usa il tuo piano (costo in dollari 0) ma consuma quota e può durare minuti: misurato su 2 documenti piccoli: circa 80.000 token in ingresso, 18 s. Esc annulla. Procedere?"))) return "Semantica annullata.";
		ensureExcluded(root);
		const abort = new AbortController();
		const stop = ctx.hasUI ? ctx.ui.onTerminalInput((data) => (data === "\x1b" ? (abort.abort(), { consume: true }) : undefined)) : () => {};
		const progress: Progress = { title: "Graphify + Claude Code", phase: "avvio", done: 0, total: 1, input: 0, output: 0, cost: 0, startedAt: Date.now(), now: 0 };
		panel(ctx, progress, true);
		const tick = setInterval(() => panel(ctx, progress, true), 500);
		try {
			const env = { GRAPHIFY_CLAUDE_CLI_MODEL: process.env.PI_GRAPH_MODEL ?? "haiku" };
			const result = await runGraphify(
				["extract", root, "--backend", "claude-cli", "--max-concurrency", "1"],
				root,
				(line) => {
					const chunk = /chunk (\d+)\/(\d+)/.exec(line);
					if (chunk) Object.assign(progress, { phase: "lettura dei documenti", done: Number(chunk[1]), total: Number(chunk[2]) });
					else if (/AST extraction/.test(line)) progress.phase = "estrazione AST";
					else if (/semantic extraction on (\d+) files/.test(line)) Object.assign(progress, { phase: "lettura dei documenti", done: 0, total: 1, current: clean(line).replace("[graphify extract] ", "") });
					else if (line.trim()) progress.current = clean(line).slice(0, 100);
				},
				abort.signal,
				env,
			);
			if (abort.signal.aborted) return "Semantica annullata.";
			if (result.code !== 0) return `Graphify non è riuscito (codice ${result.code}):\n${clean(result.out).split("\n").slice(-6).join("\n")}`;
			Object.assign(progress, { phase: "report e comunità", done: progress.total });
			panel(ctx, progress, false);
			await runGraphify(["cluster-only", root], root);
			const tokens = /tokens: ([\d,]+) in \/ ([\d,]+) out/.exec(result.out);
			const stats = readStats(root);
			return `Fatto in ${duration(Date.now() - progress.startedAt)}${stats ? `: ${stats.nodes} nodi, ${stats.edges} archi, ${stats.communities} gruppi` : ""}. Token: ${tokens ? `${tokens[1]} in, ${tokens[2]} out` : "non riportati"} (modello ${env.GRAPHIFY_CLAUDE_CLI_MODEL}, piano Claude Code, costo $0).`;
		} finally {
			clearInterval(tick);
			stop();
			panel(ctx);
		}
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

	pi.on("before_agent_start", (event, ctx) => {
		if (event.systemPrompt.includes(SUMMARY_MARKER)) return;
		const value = summaryOf(rootOf(ctx.cwd));
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
