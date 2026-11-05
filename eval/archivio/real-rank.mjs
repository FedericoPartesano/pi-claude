// Ranks for the real questions (archive = first `archiveSize` chunks of the final archive, a prefix by construction).
// Methods: bm25, rrf (bm25+e5), rw_hybrid (question + 3 haiku rewrites, bm25+e5, RRF k=60). Output feeds `retrieval-bench.mjs judge`
// (JUDGE_MODEL=sonnet for a judge other than the one that wrote the rewrites).
// Usage: node eval/archivio/real-rank.mjs <real-questions.json> <ranks-out.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { archivedEntries, chunkArchive, search } from "../../extensions/archivio.ts";
import { BackgroundEmbedder } from "../../pi-memory/src/embed.ts";
const [qFile, outFile] = process.argv.slice(2);
const items = JSON.parse(readFileSync(qFile, "utf8"));
const ask = (prompt) => new Promise((resolve) => {
	const child = spawn("claude", ["-p", "--model", "haiku", "--tools", ""], { cwd: "/tmp" });
	let o = "";
	child.stdout.on("data", (d) => (o += d));
	child.stdin.end(prompt);
	child.on("close", () => resolve(o.trim()));
});
const rwPath = "/tmp/real-rewrites.json";
const rewrites = existsSync(rwPath) ? JSON.parse(readFileSync(rwPath, "utf8")) : {};
let next = 0;
const worker = async () => {
	while (next < items.length) {
		const it = items[next++];
		if (rewrites[it.question]) continue;
		const a = await ask(`Un utente cerca in una lunga sessione di lavoro (programmazione, repository TypeScript, strumenti da riga di comando) un contenuto vecchio. Messaggio: "${it.question}"\n\nScrivi 3 query di ricerca per parole chiave, una per riga, senza numerazione, ciascuna di 4-8 termini che probabilmente compaiono nel testo originale (nomi di file o funzioni plausibili, termini tecnici in inglese e in italiano, comandi). Varia il vocabolario. Solo le 3 righe.`);
		rewrites[it.question] = a.split("\n").map((s) => s.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 3);
	}
};
await Promise.all([worker(), worker(), worker(), worker()]);
writeFileSync(rwPath, JSON.stringify(rewrites, null, 1));
const embedder = new BackgroundEmbedder();
if (!(await embedder.start())) throw new Error("embedder not ready");
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const fuse = (...lists) => {
	const score = new Map();
	for (const list of lists) list.forEach((idx, rank) => score.set(idx, (score.get(idx) ?? 0) + 1 / (60 + rank + 1)));
	return [...score].sort((a, b) => b[1] - a[1]).map((s) => s[0]);
};
const cache = new Map();
const ranks = [];
for (const it of items) {
	if (!cache.has(it.path)) {
		const branch = readFileSync(it.path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
		const chunks = chunkArchive(archivedEntries(branch));
		const vc = `/tmp/rb-vecs-${it.path.split("/").pop()}.json`;
		let vecs;
		if (existsSync(vc)) vecs = JSON.parse(readFileSync(vc, "utf8")).map((v) => Float32Array.from(v));
		else {
			vecs = [];
			for (let i = 0; i < chunks.length; i += 32) vecs.push(...(await embedder.embed(chunks.slice(i, i + 32).map((c) => c.text.slice(0, 900)), "passage")));
			writeFileSync(vc, JSON.stringify(vecs.map((v) => [...v])));
			console.error(`embedded ${chunks.length} chunks of ${it.session.slice(0, 20)}`);
		}
		cache.set(it.path, { chunks, vecs });
	}
	const { chunks, vecs } = cache.get(it.path);
	const sub = chunks.slice(0, it.archiveSize);
	const bm = (q) => search(sub, q, 20).map((h) => sub.findIndex((c) => c.entryId === h.entryId && c.text === h.text));
	const e5 = async (q) => { const [v] = await embedder.embed([q], "query"); return vecs.slice(0, it.archiveSize).map((x, i) => [i, dot(v, x)]).sort((a, b) => b[1] - a[1]).slice(0, 20).map((s) => s[0]); };
	const queries = [it.question, ...(rewrites[it.question] ?? [])];
	const bmL = queries.map(bm);
	const e5L = [];
	for (const q of queries) e5L.push(await e5(q));
	ranks.push({ path: it.path, question: it.question, gold: undefined, rank: { bm25: bmL[0].slice(0, 10), rrf: fuse(bmL[0], e5L[0]).slice(0, 10), rw_hybrid: fuse(...bmL, ...e5L).slice(0, 10) } });
}
writeFileSync(outFile, JSON.stringify(ranks));
console.log(`ranked ${ranks.length}`);
