import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeEmbedder } from "../src/embed.ts";
import { DEFAULT_THRESHOLD } from "../src/recall.ts";
import { buildArchive, evaluate } from "./synthetic.ts";

test("scale (1.000 memories, fake embedder): recall@5 on lexical queries, no false positives, <= 300 tokens, < 100 ms", async () => {
	assert.equal(buildArchive().length, 1000);
	const metrics = await evaluate(createFakeEmbedder(), DEFAULT_THRESHOLD);
	console.log(JSON.stringify(metrics));
	assert.ok(metrics.recallLexical >= 0.8, `recall lexical ${metrics.recallLexical}`);
	assert.equal(metrics.falsePositives, 0);
	assert.ok(metrics.maxTokens <= 300);
	assert.ok(metrics.recallMsMax < 100, `max ${metrics.recallMsMax} ms`);
});

test("scale without embedder (lexical only) stays usable", async () => {
	const metrics = await evaluate(undefined, DEFAULT_THRESHOLD);
	assert.ok(metrics.recallLexical >= 0.7, `recall lexical ${metrics.recallLexical}`);
	assert.ok(metrics.falsePositiveRate <= 0.1);
});
