import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeEmbedder } from "../pi-memory/src/embed.ts";
import { chunksFor, CodeIndex } from "./lean/semantic.ts";

const CART = "export function cartTotal(lines) {\n  return lines.reduce((sum, line) => sum + line.price * line.qty, 0);\n}\n\nexport function applyCoupon(total, code) {\n  return code === 'SCONTO10' ? total * 0.9 : total;\n}\n";
const LOG = "export function parseLogLine(text) {\n  const [level, message] = text.split(' ');\n  return { level, message };\n}\n";

test("chunks are the symbols of a file (path, name, first lines); a file without symbols is one chunk", () => {
	const chunks = chunksFor("src/cart.js", CART);
	assert.deepEqual(chunks.map((chunk) => [chunk.name, chunk.line]), [["cartTotal", 1], ["applyCoupon", 5]]);
	assert.match(chunks[0].text, /src\/cart\.js cartTotal\nexport function cartTotal/);
	assert.deepEqual(chunksFor("README.md", "# Libreria\nGestionale").map((chunk) => [chunk.name, chunk.line]), [["", 1]]);
});

test("search returns the closest symbols; only changed files are embedded again", async () => {
	const embedder = createFakeEmbedder();
	let calls = 0;
	const counting = { ...embedder, embed: (texts: string[], kind?: "query" | "passage") => { if (kind !== "query") calls += texts.length; return embedder.embed(texts, kind); } };
	const index = new CodeIndex();
	await index.update([{ path: "src/cart.js", mtime: 1, source: CART }, { path: "src/log.js", mtime: 1, source: LOG }], counting);
	assert.equal(calls, 3);
	const hits = await index.search("coupon code discount total", counting, 2);
	assert.equal(hits[0].path, "src/cart.js");
	assert.equal(hits[0].name, "applyCoupon");
	await index.update([{ path: "src/cart.js", mtime: 1, source: CART }, { path: "src/log.js", mtime: 2, source: LOG }], counting);
	assert.equal(calls, 4, "only log.js again");
	const restored = CodeIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())));
	assert.equal((await restored.search("log level message", counting, 1))[0].name, "parseLogLine");
	await restored.update([{ path: "src/cart.js", mtime: 1, source: CART }], counting);
	assert.equal((await restored.search("log level message", counting, 3)).some((hit) => hit.path === "src/log.js"), false, "deleted files leave the index");
});
