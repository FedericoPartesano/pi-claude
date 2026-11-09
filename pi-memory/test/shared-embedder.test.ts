import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, sharedEmbedder } from "../src/embed.ts";

// onnxruntime-node aborts the process when several worker threads run inferences at once: one embedder per model.
test("sharedEmbedder returns one instance per model", () => {
	assert.equal(sharedEmbedder(MODELS.e5), sharedEmbedder(MODELS.e5));
	assert.notEqual(sharedEmbedder(MODELS.e5), sharedEmbedder(MODELS.minilm));
});
