// Offline check on the noid bench sessions: is the planted line in the top-k of the question? bm25, and bm25 top-30 reranked by e5.
// Usage: node eval/archivio/noid-retrieval.mjs <session.jsonl>... (expects eval/ab/result-noid-B-N.json beside the same N via env)
import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive, search } from "../../extensions/archivio.ts";
import { BackgroundEmbedder } from "../../pi-memory/src/embed.ts";
const embedder = new BackgroundEmbedder();
if (!(await embedder.start())) throw new Error("embedder not ready");
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const total = { bm25: [0, 0, 0], rerank: [0, 0, 0], n: 0 };
for (const [file, result] of process.argv.slice(2).map((a) => a.split(":"))) {
	const branch = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
	const chunks = chunkArchive(archivedEntries(branch));
	const posts = JSON.parse(readFileSync(result, "utf8")).turns.filter((t) => t.phase === "post");
	for (const t of posts) {
		const question = t.prompt.length < 70 ? t.prompt : t.prompt; // prompt is cut at 70 chars in the result: re-read full text from session
		const full = branch.find((e) => e.message?.role === "user" && JSON.stringify(e.message.content).includes(t.prompt.slice(0, 40)));
		const q = full ? (typeof full.message.content === "string" ? full.message.content : full.message.content.map((c) => c.text ?? "").join(" ")) : question;
		const gold = (c) => c.text.includes(t.expect) && /rapporti|riga \d{4}/.test(c.text) && c.role !== "user";
		const top = search(chunks, q, 30);
		const rank = (list) => { const i = list.findIndex(gold); return i < 0 ? 99 : i; };
		const rb = rank(top);
		const [qv] = await embedder.embed([q], "query");
		const pv = await embedder.embed(top.map((h) => h.text.slice(0, 900)), "passage");
		const rr = rank(top.map((h, i) => [h, dot(qv, pv[i])]).sort((a, b) => b[1] - a[1]).map((x) => x[0]));
		total.n++;
		[1, 3, 10].forEach((k, j) => { if (rb < k) total.bm25[j]++; if (rr < k) total.rerank[j]++; });
		console.log(`bm25 rank ${rb} rerank ${rr} | ${q.slice(0, 70)}`);
	}
}
console.log(`n=${total.n} bm25 hit@1/3/10 ${total.bm25} | bm25+e5 rerank ${total.rerank}`);
