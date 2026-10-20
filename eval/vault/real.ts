/**
 * Vector-only vs hybrid on a real vault. Run: node eval/vault/real.ts <repo-with-vault/> (e.g. smartlookup-mono).
 * Queries are written for the smartlookup-mono vault (expected file = a path fragment among the first 3 results).
 */
import { readFileSync } from "node:fs";
import { MODELS, WorkerEmbedder } from "../../pi-memory/src/embed.ts";
import { VaultIndex } from "../../extensions/vault/index.ts";
import { findVault, readSources } from "../../extensions/vault/scan.ts";

const repo = process.argv[2];
const vault = findVault(repo, {});
const files = readSources(repo, vault, "/nonexistent");
console.log(`vault ${vault}, ${files.length} file`);

const Q: { q: string; kind: string; expect: string[] }[] = [
	{ q: "ADR-007", kind: "token", expect: ["ADR-007"] },
	{ q: "JSReport", kind: "token", expect: ["JSReport"] },
	{ q: "HashiCorp Vault secrets", kind: "token", expect: ["HashiCorp"] },
	{ q: "pnpm 12 packageManager", kind: "token", expect: ["pnpm-12"] },
	{ q: "JSONata KPI", kind: "token", expect: ["ADR-010"] },
	{ q: "mapped-types esm", kind: "token", expect: ["mapped-types"] },
	{ q: "perché le variabili d'ambiente stanno dentro l'immagine docker", kind: "concetto", expect: ["ADR-003", "Env-Strategy", "Docker"] },
	{ q: "come avvio l'ambiente di sviluppo in locale", kind: "concetto", expect: ["Local-Dev-Startup", "Common-Commands", "SETUP"] },
	{ q: "come funzionano i filtri a cascata nelle griglie", kind: "concetto", expect: ["Grid-Filters-Cascade"] },
	{ q: "perché abbiamo scelto un monorepo", kind: "concetto", expect: ["ADR-001", "Monorepo"] },
	{ q: "come si autenticano gli utenti", kind: "concetto", expect: ["Auth-Flow", "ADR-012"] },
	{ q: "bug in produzione dopo la build", kind: "concetto", expect: ["BUG-2026-09-15", "Build-Pipeline", "Troubleshooting"] },
	{ q: "ricetta della carbonara", kind: "fuori tema", expect: [] },
	{ q: "previsioni del tempo domani a Roma", kind: "fuori tema", expect: [] },
	{ q: "come vincere una partita a scacchi", kind: "fuori tema", expect: [] },
];

const embedder = new WorkerEmbedder(MODELS.e5);
await embedder.start();
const index = new VaultIndex();
const t0 = Date.now();
const stats = await index.update(files, embedder, (p) => p.done % 320 === 0 && console.log(`  ${p.done}/${p.total}`));
const secs = (Date.now() - t0) / 1000;
console.log(`${stats.chunks} sezioni, ${secs.toFixed(1)} s (${(stats.embedded / secs).toFixed(1)} sezioni/s)`);

const sum = { vector: { all: 0, token: 0, concept: 0, noise: 0 }, hybrid: { all: 0, token: 0, concept: 0, noise: 0 } };
for (const item of Q) {
	const row: string[] = [];
	for (const mode of ["vector", "hybrid"] as const) {
		const hits = await index.search(item.q, embedder, 3, mode);
		const ok = item.expect.length ? hits.some((hit) => item.expect.some((e) => hit.path.includes(e))) : hits.length === 0;
		if (ok) { sum[mode].all++; if (item.kind === "token") sum[mode].token++; if (item.kind === "concetto") sum[mode].concept++; }
		if (!item.expect.length) sum[mode].noise += hits.length;
		row.push(`${mode}: ${ok ? "ok" : "NO"} [${hits.map((h) => h.path.split("/").pop()).join(", ") || "-"}]`);
	}
	console.log(`[${item.kind}] ${item.q}\n  ${row.join("\n  ")}`);
}
console.log(`\nTotale ${Q.length}: vettori ${sum.vector.all}, ibrido ${sum.hybrid.all}. Token (6): ${sum.vector.token} / ${sum.hybrid.token}. Concetti (6): ${sum.vector.concept} / ${sum.hybrid.concept}. Rumore fuori tema (3 query): ${sum.vector.noise} / ${sum.hybrid.noise}.`);
process.exit(0);
