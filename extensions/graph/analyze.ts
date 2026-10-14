/**
 * Analysis of the project graph: communities (Louvain local moving on the file level), central files (PageRank), the
 * connections that cross communities, and the lookups the tools use (search, shortest path, explain). Deterministic:
 * the same graph always gives the same answer.
 */
import type { EdgeKind, Graph, GraphEdge, GraphNode } from "./engine.ts";

const WEIGHT: Record<EdgeKind, number> = { imports: 3, tests: 2, references: 1, documents: 1, explains: 1, defines: 0 };

export interface Community {
	id: number;
	files: string[];
	/** Most central files first. */
	top: string[];
	/** Common top folder, or the most frequent one. */
	name: string;
}

export interface Analysis {
	communities: Community[];
	/** File path → community id. */
	of: Record<string, number>;
	/** File path → PageRank score. */
	rank: Record<string, number>;
	central: { path: string; score: number; degree: number }[];
	surprising: { from: string; to: string; kind: EdgeKind; confidence: GraphEdge["confidence"]; fromCommunity: number; toCommunity: number; reason: string }[];
}

type Adjacency = Map<string, Map<string, number>>;

/** File-level weighted undirected adjacency: every node counts as its file; edges inside one file are dropped. */
export function fileAdjacency(graph: Graph): Adjacency {
	const adjacency: Adjacency = new Map();
	for (const path of Object.keys(graph.files)) adjacency.set(path, new Map());
	const link = (a: string, b: string, weight: number) => {
		if (a === b || !adjacency.has(a) || !adjacency.has(b)) return;
		adjacency.get(a)!.set(b, (adjacency.get(a)!.get(b) ?? 0) + weight);
		adjacency.get(b)!.set(a, (adjacency.get(b)!.get(a) ?? 0) + weight);
	};
	const fileOf = new Map(graph.nodes.map((node) => [node.id, node.file]));
	for (const edge of graph.edges) {
		const weight = WEIGHT[edge.kind];
		const from = fileOf.get(edge.from);
		const to = fileOf.get(edge.to);
		if (weight && from && to) link(from, to, weight);
	}
	return adjacency;
}

/** Louvain, first phase: each node moves to the neighbouring community with the best modularity gain, until none does. */
export function louvain(adjacency: Adjacency): Map<string, number> {
	const nodes = [...adjacency.keys()].sort();
	const community = new Map(nodes.map((node, index) => [node, index]));
	const strength = new Map(nodes.map((node) => [node, [...adjacency.get(node)!.values()].reduce((sum, weight) => sum + weight, 0)]));
	const twoM = [...strength.values()].reduce((sum, value) => sum + value, 0);
	if (!twoM) return community;
	const total = new Map(nodes.map((node) => [community.get(node)!, strength.get(node)!]));
	for (let pass = 0; pass < 30; pass++) {
		let moved = false;
		for (const node of nodes) {
			const own = community.get(node)!;
			const links = new Map<number, number>();
			for (const [other, weight] of adjacency.get(node)!) links.set(community.get(other)!, (links.get(community.get(other)!) ?? 0) + weight);
			const degree = strength.get(node)!;
			total.set(own, total.get(own)! - degree);
			let best = own;
			let bestGain = (links.get(own) ?? 0) - (total.get(own)! * degree) / twoM;
			for (const [candidate, weight] of [...links].sort((a, b) => a[0] - b[0])) {
				const gain = weight - ((total.get(candidate) ?? 0) * degree) / twoM;
				if (gain > bestGain + 1e-12) {
					best = candidate;
					bestGain = gain;
				}
			}
			total.set(best, (total.get(best) ?? 0) + degree);
			if (best !== own) {
				community.set(node, best);
				moved = true;
			}
		}
		if (!moved) break;
	}
	return community;
}

export function pageRank(adjacency: Adjacency, iterations = 30, damping = 0.85): Map<string, number> {
	const nodes = [...adjacency.keys()].sort();
	const size = nodes.length;
	let rank = new Map(nodes.map((node) => [node, 1 / size]));
	const out = new Map(nodes.map((node) => [node, [...adjacency.get(node)!.values()].reduce((sum, weight) => sum + weight, 0)]));
	for (let step = 0; step < iterations; step++) {
		const next = new Map(nodes.map((node) => [node, (1 - damping) / size]));
		let lost = 0;
		for (const node of nodes) {
			const share = out.get(node)!;
			if (!share) {
				lost += rank.get(node)!;
				continue;
			}
			for (const [other, weight] of adjacency.get(node)!) next.set(other, next.get(other)! + (damping * rank.get(node)! * weight) / share);
		}
		for (const node of nodes) next.set(node, next.get(node)! + (damping * lost) / size);
		rank = next;
	}
	return rank;
}

const folderOf = (path: string) => (path.includes("/") ? path.split("/").slice(0, path.split("/").length > 2 ? 2 : 1).join("/") : ".");

export function analyze(graph: Graph, limit = 12): Analysis {
	const adjacency = fileAdjacency(graph);
	const raw = louvain(adjacency);
	const rankMap = pageRank(adjacency);
	// Renumber: biggest community first, ties by name; files with no links go together in the last one.
	const groups = new Map<number, string[]>();
	for (const [path, id] of raw) groups.set(id, [...(groups.get(id) ?? []), path]);
	const linked = [...groups.values()].filter((files) => files.length > 1 || adjacency.get(files[0])!.size > 0);
	const isolated = [...groups.values()].filter((files) => files.length === 1 && adjacency.get(files[0])!.size === 0).flat();
	linked.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
	if (isolated.length) linked.push(isolated.sort());
	const of: Record<string, number> = {};
	const communities: Community[] = linked.map((files, id) => {
		for (const path of files) of[path] = id;
		const sorted = [...files].sort((a, b) => (rankMap.get(b)! - rankMap.get(a)!) || a.localeCompare(b));
		const folders = new Map<string, number>();
		for (const path of files) folders.set(folderOf(path), (folders.get(folderOf(path)) ?? 0) + 1);
		const name = id === linked.length - 1 && isolated.length ? "isolati" : [...folders].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
		return { id, files: files.sort(), top: sorted.slice(0, 5), name };
	});
	const rank: Record<string, number> = {};
	for (const [path, score] of rankMap) rank[path] = score;
	const central = [...rankMap]
		.map(([path, score]) => ({ path, score, degree: adjacency.get(path)!.size }))
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
		.slice(0, limit);

	// Surprising: links across communities, rarest pair of communities first, extracted before inferred.
	const fileOf = new Map(graph.nodes.map((node) => [node.id, node.file]));
	const pairCount = new Map<string, number>();
	const crossing: { edge: GraphEdge; from: string; to: string; key: string }[] = [];
	for (const edge of graph.edges) {
		if (!WEIGHT[edge.kind]) continue;
		const from = fileOf.get(edge.from);
		const to = fileOf.get(edge.to);
		if (!from || !to || from === to || of[from] === of[to]) continue;
		const key = [of[from], of[to]].sort((a, b) => a - b).join("-");
		pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
		crossing.push({ edge, from, to, key });
	}
	const surprising = crossing
		.map((item) => ({ item, score: (item.edge.confidence === "extracted" ? 2 : 1) / pairCount.get(item.key)! }))
		.sort((a, b) => b.score - a.score || a.item.from.localeCompare(b.item.from) || a.item.to.localeCompare(b.item.to))
		.slice(0, limit)
		.map(({ item }) => ({
			from: item.from,
			to: item.to,
			kind: item.edge.kind,
			confidence: item.edge.confidence,
			fromCommunity: of[item.from],
			toCommunity: of[item.to],
			reason: `${item.edge.kind} tra "${communities[of[item.from]].name}" e "${communities[of[item.to]].name}", unico o raro legame tra le due comunità (${pairCount.get(item.key)})`,
		}));
	return { communities, of, rank, central, surprising };
}

// ---- lookups used by the tools ----

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9_$]+/).filter((word) => word.length > 1);

/** Nodes matching a free text: every word in the label or the path, best matches first, files before symbols on ties. */
export function searchNodes(graph: Graph, query: string, analysis?: Analysis, limit = 10): GraphNode[] {
	const wanted = words(query);
	if (!wanted.length) return [];
	const scored: { node: GraphNode; score: number }[] = [];
	for (const node of graph.nodes) {
		const label = node.label.toLowerCase();
		const path = node.file.toLowerCase();
		let score = 0;
		for (const word of wanted) score += label === word ? 6 : label.includes(word) ? 3 : path.includes(word) ? 1 : 0;
		if (!score) continue;
		score += node.kind === "symbol" ? 0 : 0.5;
		score += (analysis?.rank[node.file] ?? 0) * 10;
		scored.push({ node, score });
	}
	return scored.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, limit).map((item) => item.node);
}

/** One node by exact id or label; otherwise the best search hit. */
export function findNode(graph: Graph, text: string, analysis?: Analysis): GraphNode | undefined {
	return graph.nodes.find((node) => node.id === text) ?? graph.nodes.find((node) => node.label === text && node.kind !== "symbol") ?? graph.nodes.find((node) => node.label === text) ?? searchNodes(graph, text, analysis, 1)[0];
}

export interface Neighbor {
	node: GraphNode;
	kind: EdgeKind;
	direction: "out" | "in";
	confidence: GraphEdge["confidence"];
}

export function neighbors(graph: Graph, id: string): Neighbor[] {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const result: Neighbor[] = [];
	for (const edge of graph.edges) {
		if (edge.from === id && byId.has(edge.to)) result.push({ node: byId.get(edge.to)!, kind: edge.kind, direction: "out", confidence: edge.confidence });
		else if (edge.to === id && byId.has(edge.from)) result.push({ node: byId.get(edge.from)!, kind: edge.kind, direction: "in", confidence: edge.confidence });
	}
	return result;
}

/** Shortest path between two nodes ignoring edge direction; each step names the edge used. Undefined when not connected. */
export function shortestPath(graph: Graph, from: string, to: string, maxHops = 12): { node: GraphNode; via?: string }[] | undefined {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	if (!byId.has(from) || !byId.has(to)) return undefined;
	const next = new Map<string, { id: string; kind: EdgeKind }[]>();
	const push = (a: string, b: string, kind: EdgeKind) => next.set(a, [...(next.get(a) ?? []), { id: b, kind }]);
	for (const edge of graph.edges) {
		push(edge.from, edge.to, edge.kind);
		push(edge.to, edge.from, edge.kind);
	}
	// On equal length, strong links first: imports and definitions before mentions in documents.
	for (const list of next.values()) list.sort((a, b) => (WEIGHT[b.kind] || 4) - (WEIGHT[a.kind] || 4) || a.id.localeCompare(b.id));
	const previous = new Map<string, { id: string; kind: EdgeKind } | null>([[from, null]]);
	let frontier = [from];
	for (let hop = 0; hop < maxHops && frontier.length && !previous.has(to); hop++) {
		const following: string[] = [];
		for (const id of frontier) for (const step of next.get(id) ?? []) if (!previous.has(step.id)) {
			previous.set(step.id, { id, kind: step.kind });
			following.push(step.id);
		}
		frontier = following;
	}
	if (!previous.has(to)) return undefined;
	const path: { node: GraphNode; via?: string }[] = [];
	for (let id: string | undefined = to; id; ) {
		const step = previous.get(id);
		path.unshift({ node: byId.get(id)!, via: step?.kind });
		id = step?.id;
	}
	return path;
}
