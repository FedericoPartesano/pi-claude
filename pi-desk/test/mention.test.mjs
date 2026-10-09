// "@" in the composer: which project files match what is typed after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiles, mentionAt } from "../renderer/src/mention.ts";

const files = ["src/cart.js", "src/checkout/cart-view.tsx", "test/cart.test.js", "README.md", "docs/carta.pdf"];

test("file names that start with the query first, then paths that contain it; at most n", () => {
	assert.deepEqual(matchFiles(files, "cart", 3), ["src/cart.js", "src/checkout/cart-view.tsx", "test/cart.test.js"]);
	assert.deepEqual(matchFiles(files, "read"), ["README.md"]);
	assert.deepEqual(matchFiles(files, "checkout/"), ["src/checkout/cart-view.tsx"]);
	assert.equal(matchFiles(files, "").length, 5);
});

test("the mention being typed: '@' at a word start up to the caret", () => {
	assert.deepEqual(mentionAt("guarda @src/ca", 14), { start: 7, query: "src/ca" });
	assert.deepEqual(mentionAt("@", 1), { start: 0, query: "" });
	assert.equal(mentionAt("mail a@b.it", 11), undefined);
	assert.equal(mentionAt("@cart e poi", 11), undefined);
});
