/**
 * The memory graph (like Obsidian's): explicit links between memories, both ways, plus entities as shared nodes (two
 * memories citing the same file or requirement are connected). Built once per store load: neighbours in O(degree).
 */
import type { MemoryRecord } from "./store.ts";

/** Entity hubs bigger than this connect too much to mean anything (e.g. the project name). */
const MAX_ENTITY_FANOUT = 20;

export interface MemoryGraph {
	links(id: string): string[];
	byEntity(entity: string): string[];
	/** Linked memories first, then the ones sharing a (not too common) entity. */
	neighbors(id: string): string[];
}

export function buildGraph(records: MemoryRecord[]): MemoryGraph {
	const known = new Set(records.map((record) => record.id));
	const links = new Map<string, Set<string>>();
	const entities = new Map<string, string[]>();
	const add = (from: string, to: string) => {
		const set = links.get(from) ?? new Set<string>();
		set.add(to);
		links.set(from, set);
	};
	for (const record of records) {
		for (const target of record.links ?? []) {
			if (target === record.id || !known.has(target)) continue;
			add(record.id, target);
			add(target, record.id);
		}
		for (const entity of record.entities) {
			const list = entities.get(entity) ?? [];
			list.push(record.id);
			entities.set(entity, list);
		}
	}
	const entitiesOf = new Map(records.map((record) => [record.id, record.entities]));
	return {
		links: (id) => [...(links.get(id) ?? [])],
		byEntity: (entity) => [...(entities.get(entity) ?? [])],
		neighbors(id) {
			const out = new Set(links.get(id) ?? []);
			for (const entity of entitiesOf.get(id) ?? []) {
				const list = entities.get(entity) ?? [];
				if (list.length <= MAX_ENTITY_FANOUT) for (const other of list) if (other !== id) out.add(other);
			}
			return [...out];
		},
	};
}
