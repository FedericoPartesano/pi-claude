import { test } from "node:test";
import assert from "node:assert/strict";
import { RecallIndex, cueLimit, recall, renderCues } from "../src/recall.ts";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { buildCorpus } from "./corpus.ts";

// The test runner starts each file without --expose-gc: without a collection the heap delta would count garbage.
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/**
 * Deep recall at 20k memories (lexical, no embedder: deterministic and fast enough for the suite). The 100k figures
 * come from bench/deep-bench.ts; here the guard rails: depth, constant tokens, heap and time per request.
 */
test("20k memories: the answer two links away reaches the cues, tokens stay constant, index heap and recall bounded", () => {
	const corpus = buildCorpus(20_000);
	gc();
	const before = process.memoryUsage().heapUsed;
	const index = new RecallIndex(corpus.records);
	gc();
	const heapMb = (process.memoryUsage().heapUsed - before) / 1048576;
	let hop2 = 0;
	let maxChars = 0;
	let worst = 0;
	for (const chain of corpus.chains) {
		const started = performance.now();
		const limit = cueLimit(chain.query);
		const text = renderCues(recall(index, chain.query, { today: "2026-10-08", limit }).hits, limit);
		worst = Math.max(worst, performance.now() - started);
		maxChars = Math.max(maxChars, text.length);
		if (text.includes(`#${chain.ids[2]}\n`) || text.endsWith(`#${chain.ids[2]}`)) hop2++;
	}
	assert.ok(hop2 / corpus.chains.length >= 0.75, `hop2 ${hop2}/${corpus.chains.length}`);
	assert.ok(maxChars <= 1300, `cue chars ${maxChars}`);
	assert.ok(worst < 50, `worst recall ${worst.toFixed(1)} ms`);
	assert.ok(heapMb < 25, `index heap ${heapMb.toFixed(0)} MB at 20k`);
});
