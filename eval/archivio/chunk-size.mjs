// Chunk size vs retrieval (BM25, no model): same 50 questions, gold = the entry the question was written from.
// Usage: PI_ARCHIVE_CHUNK=300 node eval/archivio/chunk-size.mjs eval/archivio/retrieval-questions.json
import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive, search } from "../../extensions/archivio.ts";
const items = JSON.parse(readFileSync(process.argv[2], "utf8"));
const K = Number(process.env.K ?? 3);
let n = 0, hit1 = 0, hitK = 0, chars = 0, chunksTotal = 0;
for (const path of new Set(items.map((i) => i.path))) {
	const branch = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
	const chunks = chunkArchive(archivedEntries(branch));
	chunksTotal += chunks.length;
	for (const it of items.filter((i) => i.path === path)) {
		const hits = search(chunks, it.question, K);
		n++;
		hit1 += hits[0]?.entryId === it.entryId ? 1 : 0;
		hitK += hits.some((h) => h.entryId === it.entryId) ? 1 : 0;
		chars += hits.reduce((s, h) => s + h.text.length, 0);
	}
}
console.log(`chunk=${process.env.PI_ARCHIVE_CHUNK ?? 900} chunks=${chunksTotal} n=${n} entry-hit@1=${(hit1 / n).toFixed(2)} entry-hit@${K}=${(hitK / n).toFixed(2)} avgExcerptChars=${Math.round(chars / n)}`);
