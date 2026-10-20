/**
 * Vector-only vs hybrid (vector + BM25) on a real corpus: the markdown of this repo (intents, docs, root notes),
 * real local model (e5-small). Run: node eval/vault/compare.ts   (about 1-2 minutes of CPU the first time)
 * Hit = an expected file among the first 3 results. Off-topic queries should return nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS, WorkerEmbedder } from "../../pi-memory/src/embed.ts";
import { VaultIndex } from "../../extensions/vault/index.ts";
import { vaultFiles } from "../../extensions/vault/scan.ts";

const root = join(import.meta.dirname, "../..");
const files = vaultFiles(root).filter((item) => /^(intents|docs|NOTES|README|HANDOFF)/.test(item.path) && !item.path.includes("2026-10-20-vault")).map((item) => ({ path: item.path, source: readFileSync(item.file, "utf8") }));

const QUERIES: { q: string; kind: string; expect: string[] }[] = [
	{ q: "PI_GRAPH_ENGINE", kind: "token", expect: ["grafo-del-progetto"] },
	{ q: "scripts/perf-baseline.mjs", kind: "token", expect: ["perf.md", "decidi-tu-come"] },
	{ q: "claude -p 250 MB", kind: "token", expect: ["decidi-tu-come", "perf.md"] },
	{ q: "Louvain label propagation", kind: "token", expect: ["grafo-del-progetto"] },
	{ q: "release-please", kind: "token", expect: ["README.md", "pi-ui"] },
	{ q: "perché le regole di caveman tagliano poco", kind: "concetto", expect: ["caveman"] },
	{ q: "quanta RAM consuma pi quando è fermo", kind: "concetto", expect: ["perf.md", "decidi-tu-come"] },
	{ q: "come ridurre il costo della cache del contesto", kind: "concetto", expect: ["prova-a-trovare", "token"] },
	{ q: "come l'agente ricorda le cose a lungo termine", kind: "concetto", expect: ["memory", "dream"] },
	{ q: "browser dentro il terminale", kind: "concetto", expect: ["browser"] },
	{ q: "ricetta della carbonara", kind: "fuori tema", expect: [] },
	{ q: "previsioni del tempo domani a Roma", kind: "fuori tema", expect: [] },
];

const embedder = new WorkerEmbedder(MODELS.e5);
await embedder.start();
const index = new VaultIndex();
const started = Date.now();
const stats = await index.update(files, embedder);
console.log(`${stats.files} file, ${stats.chunks} sezioni, embedding ${((Date.now() - started) / 1000).toFixed(1)} s (${(stats.embedded / ((Date.now() - started) / 1000)).toFixed(1)} sezioni/s)`);

const score = { vector: { hit: 0, noise: 0 }, hybrid: { hit: 0, noise: 0 } };
let tokenHits = { vector: 0, hybrid: 0 };
for (const item of QUERIES) {
	const row: string[] = [];
	for (const mode of ["vector", "hybrid"] as const) {
		const hits = await index.search(item.q, embedder, 3, mode);
		const ok = item.expect.length ? hits.some((hit) => item.expect.some((e) => hit.path.includes(e))) : hits.length === 0;
		if (ok) score[mode].hit++;
		if (ok && item.kind === "token") tokenHits[mode]++;
		if (!item.expect.length) score[mode].noise += hits.length;
		row.push(`${mode}: ${ok ? "ok" : "NO"} (${hits.length} risultati, primo: ${hits[0]?.path ?? "-"})`);
	}
	console.log(`[${item.kind}] ${item.q}\n  ${row.join("\n  ")}`);
}
console.log(`\nTotale su ${QUERIES.length}: vettori ${score.vector.hit}, ibrido ${score.hybrid.hit}. Query con token esatti (5): vettori ${tokenHits.vector}, ibrido ${tokenHits.hybrid}. Risultati su query fuori tema: vettori ${score.vector.noise}, ibrido ${score.hybrid.noise}.`);
process.exit(0);
