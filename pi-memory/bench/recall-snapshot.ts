/**
 * Recall's exact output for every corpus query (chains, superseded, unrelated, plus variations), to prove a speed-up
 * changes nothing: node bench/recall-snapshot.ts 100000 > before.json, change, run again, diff.
 */
import { createFakeEmbedder } from "../src/embed.ts";
import { RecallIndex, cueLimit, recall } from "../src/recall.ts";
import { embedText } from "../src/store.ts";
import { buildCorpus } from "../test/corpus.ts";

const size = Number(process.argv[2] ?? 10000);
const embedder = createFakeEmbedder(384);
const corpus = buildCorpus(size);
const vectors = new Map<string, Float32Array>();
for (let i = 0; i < corpus.records.length; i += 256) {
	const batch = corpus.records.slice(i, i + 256);
	(await embedder.embed(batch.map(embedText), "passage")).forEach((vector, j) => vectors.set(batch[j].id, vector));
}
const index = new RecallIndex(corpus.records);
const queries = [...corpus.chains.map((chain) => chain.query), ...corpus.supersedes.map((pair) => pair.query), ...corpus.unrelated];
for (const text of corpus.records.slice(0, 200).map((record) => record.text)) queries.push(text.split(" ").slice(0, 6).join(" "));
const out: Record<string, string[]> = {};
for (const query of queries) {
	const queryVector = (await embedder.embed([query], "query"))[0];
	const { hits } = recall(index, query, { today: "2026-10-08", vectors, queryVector, semFloor: embedder.semFloor, semSpan: embedder.semSpan, limit: cueLimit(query) });
	out[query] = hits.map((hit) => `${hit.record.id}:${hit.score.toFixed(5)}${hit.via ? ":deep" : ""}`);
}
console.log(JSON.stringify(out));
