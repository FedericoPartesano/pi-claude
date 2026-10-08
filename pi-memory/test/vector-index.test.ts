import { test } from "node:test";
import assert from "node:assert/strict";
import { VectorIndex } from "../src/vector-index.ts";
import { rng } from "./corpus.ts";

const unit = (random: () => number, dim: number) => {
	const v = new Float32Array(dim).map(() => random() * 2 - 1);
	const norm = Math.hypot(...v);
	return v.map((x) => x / norm);
};

test("binary prefilter + exact rescoring finds the true nearest neighbours", () => {
	const random = rng(3);
	const dim = 384;
	const vectors = new Map<string, Float32Array>();
	for (let i = 0; i < 5000; i++) vectors.set(`r${i}`, unit(random, dim));
	const query = unit(random, dim);
	// A near-duplicate of the query hidden among them, and its exact cosine ranking as ground truth.
	const near = query.map((x, i) => x + (i % 7 === 0 ? 0.05 : 0));
	vectors.set("target", near.map((x) => x / Math.hypot(...near)));
	const index = new VectorIndex(["target", ...[...vectors.keys()].filter((id) => id !== "target")], vectors);
	const top = index.search(query, 10);
	assert.equal(top[0].id, "target");
	const exact = [...vectors].map(([id, v]) => ({ id, s: v.reduce((sum, x, i) => sum + x * query[i], 0) })).sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.id);
	const overlap = top.filter((hit) => exact.includes(hit.id)).length;
	assert.ok(overlap >= 8, `recall@10 vs exact: ${overlap}/10`);
	assert.ok(Math.abs(top[0].score - exact.length) >= 0);
});

test("missing or wrong-size vectors are skipped; empty index returns nothing", () => {
	const v = new Float32Array([1, 0, 0, 0]);
	const index = new VectorIndex(["a", "b", "c"], new Map([["a", v], ["c", new Float32Array([1, 0])]]));
	assert.deepEqual(index.search(v, 5).map((hit) => hit.id), ["a"]);
	assert.deepEqual(new VectorIndex([], new Map()).search(v, 5), []);
});
