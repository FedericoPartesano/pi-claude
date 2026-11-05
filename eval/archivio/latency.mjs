// Measures the time added to a turn by semanticRecall: query embedding (warm worker) + scoring over the whole index.
import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive, semanticRecall } from "../../extensions/archivio.ts";
import { WorkerEmbedder, MODELS } from "../../pi-memory/src/embed.ts";
const file = process.argv[2];
const branch = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const chunks = chunkArchive(archivedEntries(branch));
const e = new WorkerEmbedder(MODELS.e5); await e.start();
const vectors = new Map();
for (let i = 0; i < chunks.length; i += 16) { const b = chunks.slice(i, i + 16); const out = await e.embed(b.map((c) => c.text.slice(0, 900)), "passage"); b.forEach((c, j) => vectors.set(c.text, out[j])); }
const qs = ["Quante anomalie ha avuto il trasportatore durante le ore notturne?", "Scrivi in una riga cosa fa un algoritmo di ordinamento a bolle.", "Quale tecnico aveva ispezionato la caldaia del reparto di verniciatura?"];
const emb = [], score = [];
for (let r = 0; r < 20; r++) for (const q of qs) {
	let t = performance.now(); const [v] = await e.embed([q], "query"); emb.push(performance.now() - t);
	t = performance.now(); semanticRecall(chunks, vectors, v, q); score.push(performance.now() - t);
}
const st = (a) => { const s = [...a].sort((x, y) => x - y); return `median ${s[s.length >> 1].toFixed(1)} ms, p95 ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms, max ${s[s.length - 1].toFixed(1)} ms`; };
console.log(`chunks ${chunks.length}, vectors ${vectors.size}\nembed query: ${st(emb)}\nscoring: ${st(score)}`);
await e.stop?.(); process.exit(0);
