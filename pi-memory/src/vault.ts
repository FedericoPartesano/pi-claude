/**
 * The memory as an Obsidian vault (/memory export): one note per active memory with its frontmatter, [[links]] to the
 * memories it links and to its entities, one note per entity listing the memories citing it, and an index. Read-only
 * view of the graph (open the folder in Obsidian, Graph view); the store stays the source of truth.
 */
import type { MemoryRecord } from "./store.ts";

/** A name usable as a file name everywhere ("/" becomes "∕", Windows-forbidden characters "_"). */
const safe = (name: string) => name.replace(/\//g, "∕").replace(/[\\:*?"<>|]/g, "_").slice(0, 120);

export function renderVault(records: MemoryRecord[]): Map<string, string> {
	const files = new Map<string, string>();
	const active = records.filter((record) => record.status === "active");
	const ids = new Set(active.map((record) => record.id));
	const byEntity = new Map<string, string[]>();
	for (const record of active) {
		for (const entity of record.entities) byEntity.set(entity, [...(byEntity.get(entity) ?? []), record.id]);
		const links = (record.links ?? []).filter((id) => ids.has(id));
		files.set(
			`ricordi/${safe(record.id)}.md`,
			[
				"---",
				`tipo: ${record.type}`,
				`conferme: ${record.confirmations}`,
				`ultima: ${record.last}`,
				...(record.state ? [`stato: ${record.state}`] : []),
				...(record.pinned ? ["fissato: true"] : []),
				"---",
				"",
				record.text,
				"",
				...(links.length ? [`Collegati: ${links.map((id) => `[[${safe(id)}]]`).join(" ")}`] : []),
				...(record.entities.length ? [`Entità: ${record.entities.map((entity) => `[[${safe(entity)}]]`).join(" ")}`] : []),
			].join("\n"),
		);
	}
	for (const [entity, memories] of byEntity) files.set(`entita/${safe(entity)}.md`, [`# ${entity}`, "", ...memories.map((id) => `- [[${safe(id)}]]`)].join("\n"));
	files.set("indice.md", ["# Memoria del progetto", "", ...active.map((record) => `- [[${safe(record.id)}]] ${record.type}: ${record.text.slice(0, 80)}`)].join("\n"));
	return files;
}
