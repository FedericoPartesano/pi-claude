import { test } from "node:test";
import assert from "node:assert/strict";
import { pushPpr } from "../src/ppr.ts";

// a - b - c - d chain, plus a hub h connected to everything.
const graph: Record<string, string[]> = { a: ["b", "h"], b: ["a", "c", "h"], c: ["b", "d", "h"], d: ["c", "h"], h: ["a", "b", "c", "d"] };
const neighbors = (node: string) => graph[node] ?? [];

test("push PPR: mass flows from the seed along the chain, decreasing with distance", () => {
	const scores = pushPpr(new Map([["a", 1]]), neighbors, { alpha: 0.5, epsilon: 1e-5 });
	assert.ok((scores.get("a") ?? 0) > (scores.get("b") ?? 0));
	assert.ok((scores.get("b") ?? 0) > (scores.get("c") ?? 0));
	assert.ok((scores.get("c") ?? 0) > (scores.get("d") ?? 0));
	assert.ok((scores.get("d") ?? 0) > 0);
});

test("push PPR: hubs are not expanded (they would connect everything), work is bounded", () => {
	const scores = pushPpr(new Map([["a", 1]]), neighbors, { alpha: 0.5, epsilon: 1e-5, isHub: (node) => node === "h" });
	assert.ok((scores.get("h") ?? 0) > 0, "a hub still receives mass");
	let calls = 0;
	pushPpr(new Map([["a", 1]]), (node) => (calls++, neighbors(node)), { alpha: 0.5, epsilon: 1e-9, maxPushes: 50 });
	assert.ok(calls <= 50);
});
