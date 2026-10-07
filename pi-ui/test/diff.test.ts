import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { diffCounts, parsePatch, renderDiff } from "../src/diff.ts";

const PATCH = `--- a/src/cart.js\n+++ b/src/cart.js\n@@ -3,4 +3,4 @@\n export function totalValue(items) {\n   if (!items?.length) return 0;\n-  return round(items.reduce((s, i) => s + i.price, 0));\n+  return round(items.reduce((s, i) => s + i.price * i.qty, 0));\n }\n`;
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("parsePatch keeps changed lines with their line numbers", () => {
	assert.deepEqual(parsePatch(PATCH), [
		{ kind: "del", line: 5, text: "  return round(items.reduce((s, i) => s + i.price, 0));" },
		{ kind: "add", line: 5, text: "  return round(items.reduce((s, i) => s + i.price * i.qty, 0));" },
	]);
	assert.deepEqual(diffCounts(PATCH), { added: 1, removed: 1 });
});

test("renderDiff: numbered rows at full width, at most `max` then a count of the rest", () => {
	const rows = renderDiff(parsePatch(PATCH), 100, 6);
	assert.equal(rows.length, 2);
	assert.match(strip(rows[0]), /^\s+5 -\s+return round/);
	assert.match(strip(rows[1]), /^\s+5 \+\s+return round/);
	for (const row of rows) assert.equal(visibleWidth(row), 100);
	const many = parsePatch(`@@ -1,0 +1,9 @@\n${Array.from({ length: 9 }, (_, i) => `+riga ${i}`).join("\n")}\n`);
	const shown = renderDiff(many, 60, 6);
	assert.equal(shown.length, 7);
	assert.match(strip(shown[6]), /… altre 3 righe/);
});
