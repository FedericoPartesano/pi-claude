/**
 * Where recall spends its time at large N, and why a two-hop answer is missed: per phase timings (BM25, entities,
 * vectors, full recall) and, for each missed chain, whether the first hop seeded the walk and where the answer ranked.
 *   node --expose-gc --max-old-space-size=10000 bench/scale-probe.ts 1000000
 */
import { createFakeEmbedder } from "../src/embed.ts";
import { pushPpr } from "../src/ppr.ts";
import { DEPTH, RecallIndex, cueLimit, recall, renderCues } from "../src/recall.ts";
import { embedText } from "../src/store.ts";
import { buildCorpus } from "../test/corpus.ts";

const size = Number(process.argv[2] ?? 100000);
const embedder = createFakeEmbedder();
const corpus = buildCorpus(size, { decoys: process.argv.includes("--decoys") });
const vectors = new Map<string, Float32Array>();
for (let i = 0; i < corpus.records.length; i += 256) {
	const batch = corpus.records.slice(i, i + 256);
	(await embedder.embed(batch.map(embedText), "passage")).forEach((vector, j) => vectors.set(batch[j].id, vector));
}
const index = new RecallIndex(corpus.records);
index.vectorsFor(vectors);
const position = new Map(corpus.records.map((record, at) => [record.id, at]));
const phases: Record<string, number[]> = { bm25: [], entities: [], vectors: [], recall: [] };
const time = (name: string, run: () => unknown) => {
	const t0 = performance.now();
	const out = run();
	phases[name].push(performance.now() - t0);
	return out;
};
const reasons: Record<string, number> = {};
for (const chain of corpus.chains) {
	const queryVector = (await embedder.embed([chain.query], "query"))[0];
	const lexical = time("bm25", () => index.bm25(chain.query)) as ReturnType<RecallIndex["bm25"]>;
	const bm = lexical.touched.map((p) => [p, lexical.scores[p]] as [number, number]);
	time("entities", () => index.entityMatches(chain.query));
	time("vectors", () => index.vectorsFor(vectors).search(queryVector, 64));
	const limit = cueLimit(chain.query);
	const { hits } = time("recall", () => recall(index, chain.query, { today: "2026-10-08", vectors, queryVector, semFloor: embedder.semFloor, semSpan: embedder.semSpan, limit })) as ReturnType<typeof recall>;
	const shown = new Set([...renderCues(hits, limit).matchAll(/#(r\d+)$/gm)].map((match) => match[1]));
	if (shown.has(chain.ids[2])) continue;
	const [a, b, c] = chain.ids.map((id) => position.get(id)!);
	const direct = hits.filter((hit) => hit.via !== "deep").map((hit) => hit.record.id);
	let reason: string;
	if (!direct.includes(chain.ids[0])) reason = `A non è tra i colpi diretti (bm25 rank ${[...bm].sort((x, y) => y[1] - x[1]).findIndex(([p]) => p === a)})`;
	else {
		const mass = pushPpr(new Map([[`m${a}`, 1]]), index.neighbors, { alpha: DEPTH.alpha, epsilon: DEPTH.epsilon });
		const ranked = [...mass].sort((x, y) => y[1] - x[1]).map(([node]) => Number(node.slice(1)));
		reason = !mass.has(`m${c}`) ? `C non raggiunto da A (B ${mass.has(`m${b}`) ? "sì" : "no"}, vicini di A ${index.neighbors(`m${a}`).length})` : `C raggiunto, rango ${ranked.indexOf(c)} di ${ranked.length} (B rango ${ranked.indexOf(b)})`;
	}
	const key = `${chain.via}: ${reason.replace(/\d+/g, "#")}`;
	reasons[key] = (reasons[key] ?? 0) + 1;
	if ((reasons[key] ?? 0) <= 2) console.log(`  ✗ ${chain.via} ${reason}`);
}
const pct = (values: number[], p: number) => [...values].sort((x, y) => x - y)[Math.min(values.length - 1, Math.floor(values.length * p))].toFixed(1);
console.log(`N=${size} · ${Object.entries(phases).map(([name, values]) => `${name} p50 ${pct(values, 0.5)} p95 ${pct(values, 0.95)}`).join(" · ")}`);
for (const [key, count] of Object.entries(reasons)) console.log(`  ${count}× ${key}`);
