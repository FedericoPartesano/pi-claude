// Full e5 (every chunk embedded) and RRF with bm25 on one noid session. Usage: node eval/archivio/noid-e5.mjs <session.jsonl>:<result.json>
import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive, search } from "../../extensions/archivio.ts";
import { BackgroundEmbedder } from "../../pi-memory/src/embed.ts";
const embedder = new BackgroundEmbedder();
if (!(await embedder.start())) throw new Error("embedder not ready");
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const [file, result] = process.argv[2].split(":");
const branch = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const chunks = chunkArchive(archivedEntries(branch));
const vecs = [];
for (let i = 0; i < chunks.length; i += 32) vecs.push(...(await embedder.embed(chunks.slice(i, i + 32).map((c) => c.text.slice(0, 900)), "passage")));
console.log(`embedded ${chunks.length}`);
const posts = JSON.parse(readFileSync(result, "utf8")).turns.filter((t) => t.phase === "post");
const hits = { e5: [0, 0, 0], rrf: [0, 0, 0] };
for (const t of posts) {
	const full = branch.find((e) => e.message?.role === "user" && JSON.stringify(e.message.content).includes(t.prompt.slice(0, 40)));
	const q = typeof full.message.content === "string" ? full.message.content : full.message.content.map((c) => c.text ?? "").join(" ");
	const gold = (c) => c.text.includes(t.expect) && /rapporti|riga \d{4}/.test(c.text) && c.role !== "user";
	const [qv] = await embedder.embed([q], "query");
	const e5 = vecs.map((v, i) => [i, dot(qv, v)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
	const bm = search(chunks, q, 20).map((h) => chunks.findIndex((c) => c.entryId === h.entryId && c.text === h.text));
	const score = new Map();
	for (const list of [e5.slice(0, 20), bm]) list.forEach((i, r) => score.set(i, (score.get(i) ?? 0) + 1 / (61 + r)));
	const rrf = [...score].sort((a, b) => b[1] - a[1]).map((s) => s[0]);
	const rank = (l) => { const i = l.findIndex((x) => gold(chunks[x])); return i < 0 ? 99 : i; };
	const re = rank(e5), rr = rank(rrf);
	[1, 3, 10].forEach((k, j) => { if (re < k) hits.e5[j]++; if (rr < k) hits.rrf[j]++; });
	console.log(`e5 ${re} rrf ${rr} | ${q.slice(0, 60)}`);
}
console.log(`n=${posts.length} e5 hit@1/3/10 ${hits.e5} rrf ${hits.rrf}`);
