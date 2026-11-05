// Query rewriting: haiku turns the vague question into 3 keyword queries (guessing the vocabulary of the old text);
// BM25 (and e5) run on the question plus the 3 rewrites, fused with RRF k=60. Ranks go to a file in the format of
// retrieval-bench.mjs `judge`, so every method is judged by the same pooled relevance.
// Usage: node eval/archivio/rewrite-bench.mjs <questions.json> <ranks-in.json> <ranks-out.json>   (needs /tmp/rb-vecs-* from `run`)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { archivedEntries, chunkArchive, search } from "../../extensions/archivio.ts";
import { BackgroundEmbedder } from "../../pi-memory/src/embed.ts";

const [qFile, ranksIn, ranksOut] = process.argv.slice(2);
const ranks = JSON.parse(readFileSync(ranksIn, "utf8"));
const ask = (prompt) => new Promise((resolve) => {
	const child = spawn("claude", ["-p", "--model", "haiku", "--tools", ""], { cwd: "/tmp" });
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	child.stdin.end(prompt);
	child.on("close", () => resolve(out.trim()));
});
const cachePath = "/tmp/rewrites.json";
const rewrites = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
let next = 0;
const worker = async () => {
	while (next < ranks.length) {
		const r = ranks[next++];
		if (rewrites[r.question]) continue;
		const a = await ask(`Un utente cerca in una lunga sessione di lavoro (programmazione, repository TypeScript, strumenti da riga di comando) un contenuto vecchio. Domanda: "${r.question}"\n\nScrivi 3 query di ricerca per parole chiave, una per riga, senza numerazione, ciascuna di 4-8 termini che probabilmente compaiono nel testo originale (nomi di file o funzioni plausibili, termini tecnici in inglese e in italiano, comandi). Varia il vocabolario tra le tre righe. Solo le 3 righe.`);
		rewrites[r.question] = a.split("\n").map((s) => s.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 3);
	}
};
await Promise.all([worker(), worker(), worker(), worker()]);
writeFileSync(cachePath, JSON.stringify(rewrites, null, 1));

const embedder = new BackgroundEmbedder();
if (!(await embedder.start())) throw new Error("embedder not ready");
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const fuse = (...lists) => {
	const score = new Map();
	for (const list of lists) list.forEach((idx, rank) => score.set(idx, (score.get(idx) ?? 0) + 1 / (60 + rank + 1)));
	return [...score].sort((a, b) => b[1] - a[1]).map((s) => s[0]);
};
const cache = new Map();
for (const r of ranks) {
	if (!cache.has(r.path)) {
		const branch = readFileSync(r.path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
		const chunks = chunkArchive(archivedEntries(branch));
		const vecs = JSON.parse(readFileSync(`/tmp/rb-vecs-${r.path.split("/").pop()}.json`, "utf8")).map((v) => Float32Array.from(v));
		cache.set(r.path, { chunks, vecs, index: new Map(chunks.map((c, i) => [c, i])) });
	}
	const { chunks, vecs } = cache.get(r.path);
	const bm = (q) => search(chunks, q, 20).map((h) => chunks.indexOf(chunks.find((c) => c.entryId === h.entryId && c.text === h.text)));
	const queries = [r.question, ...(rewrites[r.question] ?? [])];
	const bmLists = queries.map(bm);
	const e5Lists = [];
	for (const q of queries) {
		const [v] = await embedder.embed([q], "query");
		e5Lists.push(vecs.map((x, i) => [i, dot(v, x)]).sort((a, b) => b[1] - a[1]).slice(0, 20).map((s) => s[0]));
	}
	r.rank.rw_bm25 = fuse(...bmLists).slice(0, 10);
	r.rank.rw_bm25_only = fuse(...bmLists.slice(1)).slice(0, 10);
	r.rank.rw_hybrid = fuse(...bmLists, ...e5Lists).slice(0, 10);
}
writeFileSync(ranksOut, JSON.stringify(ranks));
console.log(`rewrites: ${Object.keys(rewrites).length}, e.g. ${JSON.stringify(Object.values(rewrites)[0])}`);
