/** Text of the project graph for the model and the terminal: the prompt summary and the answers of the tools. */
import { type Analysis, type Neighbor, neighbors, searchNodes } from "./analyze.ts";
import type { Graph, GraphNode } from "./engine.ts";

export const SUMMARY_MARKER = "Grafo del progetto (";
const SUMMARY_MAX = 1500;

const where = (node: GraphNode) => (node.kind === "symbol" ? `${node.file}:${node.line ?? 1} ${node.label}` : node.file);

/** Short and stable overview for the system prompt: size, biggest communities with their central files, central files. */
export function summaryText(graph: Graph, analysis: Analysis): string {
	const symbols = graph.nodes.filter((node) => node.kind === "symbol").length;
	const communities = analysis.communities.filter((community) => community.name !== "isolati" && community.files.length >= 3);
	const lines = [
		`${SUMMARY_MARKER}${Object.keys(graph.files).length} file, ${symbols} simboli, ${graph.edges.length} archi, ${communities.length} gruppi). Prima di cercare a tappeto usa graph_query (cosa fa / dove sta), graph_explain (chi usa un file o simbolo), graph_path (come due parti sono collegate).`,
		`Gruppi: ${communities.slice(0, 8).map((community) => `${community.name} (${community.files.length}: ${community.top.slice(0, 2).map((path) => path.split("/").pop()).join(", ")})`).join("; ")}`,
		`File centrali: ${analysis.central.slice(0, 8).map((entry) => entry.path).join(", ")}`,
		"Gli archi 'inferred' sono ipotesi: verifica nel codice prima di affermarli.",
	];
	let text = lines.join("\n");
	while (text.length > SUMMARY_MAX && lines.length > 2) {
		lines.splice(lines.length - 2, 1);
		text = lines.join("\n");
	}
	return text.slice(0, SUMMARY_MAX);
}

export function formatSearch(graph: Graph, analysis: Analysis, query: string, limit = 10): string {
	const hits = searchNodes(graph, query, analysis, limit);
	if (!hits.length) return `Nessun nodo per "${query}".`;
	return hits.map((node) => `${where(node)}${node.kind === "symbol" ? "" : ` [${node.kind}]`} · gruppo ${analysis.communities[analysis.of[node.file]]?.name ?? "?"}`).join("\n");
}


/** One node: its group, and what it links to or is used by, strongest links first. */
export function formatExplain(graph: Graph, analysis: Analysis, node: GraphNode, perKind = 8): string {
	const around = neighbors(graph, node.id);
	const head = `${where(node)} [${node.kind}] · gruppo ${analysis.communities[analysis.of[node.file]]?.name ?? "?"}`;
	if (!around.length) return `${head}\nNessun collegamento.`;
	const groups = new Map<string, Neighbor[]>();
	for (const neighbor of around) {
		const key = `${neighbor.direction === "out" ? "→" : "←"} ${neighbor.kind}`;
		groups.set(key, [...(groups.get(key) ?? []), neighbor]);
	}
	const lines = [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([key, list]) => {
		const shown = list.slice(0, perKind).map((neighbor) => `${where(neighbor.node)}${neighbor.confidence === "inferred" ? " (?)" : ""}`);
		return `${key} (${list.length}): ${shown.join(", ")}${list.length > perKind ? ", …" : ""}`;
	});
	return `${head}\n${lines.join("\n")}`;
}

export function formatPath(path: { node: GraphNode; via?: string }[] | undefined, from: string, to: string): string {
	if (!path) return `Nessun percorso tra ${from} e ${to} (entro 12 passi).`;
	return path.map((step) => `${step.via ? `-${step.via}-> ` : ""}${where(step.node)}`).join("\n");
}

