/**
 * Deep-memory benchmark: node bench/deep-bench.ts [sizes=1000,10000,100000] [--real]
 * For each size: index build time, heap, recall latency (p50/p95), and what reaches the model's cues for planted
 * 3-memory chains (hop 0 = matches the query, hop 2 = the answer two links away), superseded facts and unrelated
 * requests. --real uses the e5-small model (slow to embed: use small sizes); default a hashing embedder.
 */
import { BackgroundEmbedder, MODELS, createFakeEmbedder, type Embedder } from "../src/embed.ts";
import { RecallIndex, cueLimit, recall, renderCues } from "../src/recall.ts";
import { embedText } from "../src/store.ts";
import { buildCorpus } from "../test/corpus.ts";

const sizes = (process.argv.find((arg) => /^\d/.test(arg)) ?? "1000,10000,100000").split(",").map(Number);
const real = process.argv.includes("--real");
const embedder: Embedder = real ? new BackgroundEmbedder(MODELS.e5) : createFakeEmbedder(384);
if (real && !(await (embedder as BackgroundEmbedder).start())) throw new Error("model failed to load");
const today = "2026-10-08";
const pct = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const mb = (bytes: number) => `${Math.round(bytes / 1048576)}MB`;

for (const size of sizes) {
	const corpus = buildCorpus(size);
	let started = performance.now();
	const vectors = new Map<string, Float32Array>();
	for (let i = 0; i < corpus.records.length; i += 64) {
		const batch = corpus.records.slice(i, i + 64);
		(await embedder.embed(batch.map(embedText), "passage")).forEach((vector, j) => vectors.set(batch[j].id, vector));
	}
	const embedMs = performance.now() - started;
	global.gc?.();
	const heapBefore = process.memoryUsage().heapUsed;
	started = performance.now();
	const index = new RecallIndex(corpus.records);
	const buildMs = performance.now() - started;
	const heap = process.memoryUsage().heapUsed - heapBefore;
	const times: number[] = [];
	const ask = async (query: string) => {
		const queryVector = (await embedder.embed([query], "query"))[0];
		const t0 = performance.now();
		const limit = cueLimit(query);
		const { hits } = recall(index, query, { today, vectors, queryVector, semFloor: embedder.semFloor, semSpan: embedder.semSpan, limit });
		const text = renderCues(hits, limit);
		times.push(performance.now() - t0);
		return { text, ids: new Set([...text.matchAll(/#(r\d+)$/gm)].map((match) => match[1])) };
	};
	const hop = [0, 0, 0];
	const hopBy = { linked: [0, 0, 0], entity: [0, 0, 0] };
	let chars = 0;
	for (const chain of corpus.chains) {
		const { ids, text } = await ask(chain.query);
		chars += text.length;
		chain.ids.forEach((id, h) => {
			if (ids.has(id)) {
				hop[h]++;
				hopBy[chain.via][h]++;
			}
		});
	}
	let fresh = 0;
	let stale = 0;
	for (const pair of corpus.supersedes) {
		const { ids } = await ask(pair.query);
		if (ids.has(pair.newId)) fresh++;
		if (ids.has(pair.oldId)) stale++;
	}
	let falsePositives = 0;
	for (const query of corpus.unrelated) if ((await ask(query)).ids.size > 0) falsePositives++;
	const n = corpus.chains.length;
	const half = n / 2;
	const r = (value: number, of: number) => `${Math.round((value / of) * 100)}%`;
	console.log(
		[
			`N=${size}${real ? " (e5)" : ""}`,
			`embed ${Math.round(embedMs)}ms · index ${Math.round(buildMs)}ms · heap +${mb(heap)}`,
			`hop0 ${r(hop[0], n)} hop1 ${r(hop[1], n)} hop2 ${r(hop[2], n)} (linked ${r(hopBy.linked[2], half)} · entity ${r(hopBy.entity[2], half)})`,
			`superseded: new ${r(fresh, corpus.supersedes.length)} old ${stale} · FP ${falsePositives}/${corpus.unrelated.length}`,
			`recall p50 ${pct(times, 0.5).toFixed(1)}ms p95 ${pct(times, 0.95).toFixed(1)}ms · ~${Math.round(chars / n / 3.6)} tok/query`,
		].join(" | "),
	);
}
process.exit(0);
