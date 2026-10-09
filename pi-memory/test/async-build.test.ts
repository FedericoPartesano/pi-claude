import { test } from "node:test";
import assert from "node:assert/strict";
import { RecallIndex, recall } from "../src/recall.ts";
import { buildCorpus } from "./corpus.ts";

/** Longest stretch the event loop was blocked while `work` ran (a 1 ms ticker measures the gaps). */
async function worstGap(work: () => Promise<unknown>): Promise<number> {
	let last = performance.now();
	let worst = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		worst = Math.max(worst, now - last);
		last = now;
	}, 1);
	try {
		await work();
	} finally {
		clearInterval(timer);
	}
	return worst;
}

test("RecallIndex.build: same index as the constructor, never blocking the UI thread for long", async () => {
	const corpus = buildCorpus(30_000);
	let built: RecallIndex | undefined;
	const gap = await worstGap(async () => {
		built = await RecallIndex.build(corpus.records);
	});
	const sync = new RecallIndex(corpus.records);
	for (const chain of corpus.chains.slice(0, 10)) {
		const a = recall(built!, chain.query, { today: "2026-10-08", limit: 8 }).hits.map((hit) => hit.record.id);
		const b = recall(sync, chain.query, { today: "2026-10-08", limit: 8 }).hits.map((hit) => hit.record.id);
		assert.deepEqual(a, b);
	}
	// Only the fallback path (no worker): slices keep it responsive, but garbage-collection pauses of a 30k index on this
	// thread reach 40-90 ms. The normal path builds in the worker (memory-worker.test.ts: < 30 ms on the UI thread).
	assert.ok(gap < 150, `event loop blocked ${gap.toFixed(0)} ms`);
});
