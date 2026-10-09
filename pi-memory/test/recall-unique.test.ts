import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeEmbedder } from "../src/embed.ts";
import { RecallIndex, cueLimit, recall } from "../src/recall.ts";
import { embedText } from "../src/store.ts";
import { buildCorpus } from "./corpus.ts";

test("a memory never appears twice in one recall (deep cues and the back-fill of direct hits), with decoys too", async () => {
	for (const decoys of [false, true]) {
		const corpus = buildCorpus(3000, { decoys });
		const embedder = createFakeEmbedder(384);
		const vectors = new Map<string, Float32Array>();
		const texts = await embedder.embed(corpus.records.map(embedText), "passage");
		corpus.records.forEach((record, i) => vectors.set(record.id, texts[i]));
		const index = new RecallIndex(corpus.records);
		const queries = [...corpus.chains.map((chain) => chain.query), ...corpus.supersedes.map((pair) => pair.query), ...corpus.records.slice(0, 300).map((record) => record.text)];
		for (const query of queries) {
			const queryVector = (await embedder.embed([query], "query"))[0];
			const { hits } = recall(index, query, { today: "2026-10-09", vectors, queryVector, semFloor: embedder.semFloor, semSpan: embedder.semSpan, limit: Math.max(cueLimit(query), 8) });
			const ids = hits.map((hit) => hit.record.id);
			assert.equal(new Set(ids).size, ids.length, `${query}: ${ids.join(",")}`);
		}
	}
});

test("a direct hit the walk already reached is not added again by the back-fill", () => {
	const mk = (id: string, text: string, extra: object = {}) => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active" as const, entities: [], ...extra });
	const records = [
		mk("a", "fatturazione elettronica sdi errore scarto fatturazione elettronica sdi", { links: ["d"] }),
		mk("b", "fatturazione elettronica sdi errore scarto fatturazione"),
		mk("c", "fatturazione elettronica sdi errore scarto"),
		mk("d", "fatturazione elettronica sdi errore scarto"),
		...Array.from({ length: 40 }, (_, i) => mk(`x${i}`, `magazzino scorte ubicazione ${i}`)),
	];
	const index = new RecallIndex(records);
	const { hits } = recall(index, "fatturazione elettronica sdi errore scarto", { today: "2026-10-09", limit: 5, threshold: 0.01 });
	const ids = hits.map((hit) => hit.record.id);
	assert.equal(new Set(ids).size, ids.length, ids.join(","));
});
