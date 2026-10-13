import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMap, readProject } from "./project-map.ts";

test("la mappa elenca cartelle e file grandi ed e' corta", () => {
	const files = Array.from({ length: 300 }, (_, i) => `src/mod${i % 7}/f${i}.ts`).concat(["README.md"]);
	const map = buildMap(files, new Map([["src/mod1/f1.ts", 90000]]));
	assert.match(map, /src\/mod1\/ \(/);
	assert.match(map, /src\/mod1\/f1\.ts 90k/);
	assert.ok(map.length <= 3200);
});
test("e' stabile: stesso input, stesso testo (cache)", () => {
	const files = ["a/b/c.ts", "a/b/d.ts", "x.ts"]; const s = new Map<string, number>();
	assert.equal(buildMap(files, s), buildMap(files, s));
});
test("cartella senza git: niente mappa", () => assert.equal(readProject("/tmp"), undefined));
