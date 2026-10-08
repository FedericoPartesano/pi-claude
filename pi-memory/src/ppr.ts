/**
 * Approximate Personalized PageRank by local push (Andersen, Chung, Lang 2006), as HippoRAG uses PPR for multi-hop
 * recall: mass starts on the seeds (the memories and entities the request hits) and flows along the graph. The work
 * depends on epsilon and on the seeds' neighbourhood, not on the size of the graph: fit for 100k+ memories.
 */
export interface PprOptions {
	/** Restart probability: the share of mass that stays at a node (HippoRAG 2: damping 0.5). */
	alpha?: number;
	/** A node is pushed while its residual exceeds epsilon × degree. */
	epsilon?: number;
	/** Nodes that receive mass but never spread it (an entity shared by thousands of memories connects nothing). */
	isHub?: (node: string) => boolean;
	/** Hard bound on the work. */
	maxPushes?: number;
}

export function pushPpr(seeds: Map<string, number>, neighbors: (node: string) => string[], options: PprOptions = {}): Map<string, number> {
	const alpha = options.alpha ?? 0.5;
	const epsilon = options.epsilon ?? 1e-4;
	const maxPushes = options.maxPushes ?? 20_000;
	const total = [...seeds.values()].reduce((sum, value) => sum + value, 0) || 1;
	const estimate = new Map<string, number>();
	const residual = new Map<string, number>();
	const queue: string[] = [];
	const cache = new Map<string, string[]>();
	const next = (node: string) => {
		let list = cache.get(node);
		if (!list) {
			list = options.isHub?.(node) ? [] : neighbors(node);
			cache.set(node, list);
		}
		return list;
	};
	for (const [node, value] of seeds) {
		residual.set(node, value / total);
		queue.push(node);
	}
	let pushes = 0;
	while (queue.length > 0 && pushes < maxPushes) {
		const node = queue.pop()!;
		const mass = residual.get(node) ?? 0;
		const out = next(node);
		if (mass <= epsilon * Math.max(1, out.length)) continue;
		pushes++;
		residual.set(node, 0);
		estimate.set(node, (estimate.get(node) ?? 0) + alpha * mass);
		if (out.length === 0) continue;
		const share = ((1 - alpha) * mass) / out.length;
		for (const target of out) {
			const before = residual.get(target) ?? 0;
			const after = before + share;
			residual.set(target, after);
			if (before <= epsilon * Math.max(1, (cache.get(target) ?? []).length || 1) && after > epsilon) queue.push(target);
		}
	}
	return estimate;
}
