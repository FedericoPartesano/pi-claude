/**
 * Scale benchmark with the real embedding model: node bench/recall-bench.ts [minilm|e5]
 * Prints recall@5, false positives on unrelated queries, injected tokens and latency over a threshold x floor grid.
 */
import { BackgroundEmbedder, MODELS } from "../src/embed.ts";
import { embedText } from "../src/store.ts";
import { DEFAULT_THRESHOLD } from "../src/recall.ts";
import { TARGETS, UNRELATED, buildArchive, evaluate } from "../test/synthetic.ts";

const key = process.argv[2] ?? process.env.PI_MEMORY_MODEL ?? "minilm";
const embedder = new BackgroundEmbedder(MODELS[key]);
let started = performance.now();
console.log(`model ${embedder.model}`);
if (!(await embedder.start())) throw new Error("model failed to load");
console.log(`load: ${Math.round(performance.now() - started)} ms (includes download on first run)`);

const records = buildArchive();
started = performance.now();
const vectors = new Map<string, Float32Array>();
for (let i = 0; i < records.length; i += 32) {
	const batch = records.slice(i, i + 32);
	(await embedder.embed(batch.map((r) => (process.argv.includes("--plain") ? r.text : embedText(r))), "passage")).forEach((v, j) => vectors.set(batch[j].id, v));
}
console.log(`embed ${records.length} memories: ${Math.round(performance.now() - started)} ms`);
const queries = [...TARGETS.map((t) => t.lexical), ...TARGETS.map((t) => t.paraphrase), ...UNRELATED];
started = performance.now();
const queryVectors = new Map<string, Float32Array>();
for (const q of queries) queryVectors.set(q, (await embedder.embed([q], "query"))[0]);
console.log(`embed one query: ${((performance.now() - started) / queries.length).toFixed(1)} ms avg`);

const prepared = { records, vectors, queryVectors };
const row = (floor: number, threshold: number, m: Awaited<ReturnType<typeof evaluate>>) =>
	`floor ${floor.toFixed(2)} thr ${threshold.toFixed(2)} | recall@5 lex ${m.recallLexical.toFixed(2)} para ${m.recallParaphrase.toFixed(2)} all ${m.recallAll.toFixed(2)} | FP ${m.falsePositives}/${UNRELATED.length} | tok mean ${m.meanTokensRelevant.toFixed(0)} max ${m.maxTokens.toFixed(0)} | recall ms mean ${m.recallMsMean.toFixed(1)} max ${m.recallMsMax.toFixed(1)}`;
const profile = MODELS[key];
const run = (floor: number, span: number, threshold: number) => evaluate({ embed: embedder.embed.bind(embedder), semFloor: floor, semSpan: span }, threshold, prepared);
console.log("\nGrid (rows with at most 1 false positive):");
for (const floor of [profile.semFloor - 0.1, profile.semFloor - 0.05, profile.semFloor, profile.semFloor + 0.05, profile.semFloor + 0.1]) {
	for (const span of [profile.semSpan * 0.5, profile.semSpan * 0.75, profile.semSpan, profile.semSpan * 1.5]) {
		for (const threshold of [0.35, 0.4, 0.45]) {
			const m = await run(floor, span, threshold);
			if (m.falsePositives <= 1) console.log(`span ${span.toFixed(2)} ` + row(floor, threshold, m));
		}
	}
}
console.log(`\nDEFAULT (floor ${profile.semFloor}, span ${profile.semSpan}, thr ${DEFAULT_THRESHOLD}):`);
console.log(row(profile.semFloor, DEFAULT_THRESHOLD, await run(profile.semFloor, profile.semSpan, DEFAULT_THRESHOLD)));
