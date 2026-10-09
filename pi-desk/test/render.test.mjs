import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const context = { window: {} };
runInNewContext(readFileSync(new URL("../ui/render.js", import.meta.url), "utf8"), context);
const { markdown, extract, chartSvg } = context.window.PiRender;

test("markdown: headings, nested lists, ordered lists, tables, quotes, code with language, inline marks, links", () => {
	const html = markdown(["## Problemi", "", "1. **Società** incoerente", "2. RF-05 *assente*", "", "- uno", "  - due", "", "| a | b |", "|---|---:|", "| 1 | 2 |", "", "> nota", "", "```ts", "const x = 1 < 2;", "```", "", "vedi [docs](https://example.com) e `code`", "", "---"].join("\n"));
	assert.match(html, /<h2>Problemi<\/h2>/);
	assert.match(html, /<ol><li><strong>Società<\/strong> incoerente<\/li><li>RF-05 <em>assente<\/em><\/li><\/ol>/);
	assert.match(html, /<ul><li>uno<ul><li>due<\/li><\/ul><\/li><\/ul>/);
	assert.match(html, /<table>.*<th>a<\/th><th class="right">b<\/th>.*<td>1<\/td><td class="right">2<\/td>/s);
	assert.match(html, /<blockquote>.*nota.*<\/blockquote>/s);
	assert.match(html, /class="code".*data-lang="ts".*const x = 1 &lt; 2;/s);
	assert.match(html, /<a href="https:\/\/example.com"[^>]*>docs<\/a>/);
	assert.match(html, /<code>code<\/code>/);
	assert.match(html, /<hr>/);
});

test("markdown never lets HTML through (page and model text are untrusted)", () => {
	const html = markdown(`<img src=x onerror=alert(1)> **ok** [x](javascript:alert(1))`);
	assert.ok(!/<img/.test(html));
	assert.match(html, /&lt;img/);
	assert.ok(!/href="javascript/.test(html));
});

test("extract: suggestions and charts are cut out of the answer", () => {
	const { text, suggestions, charts } = extract(['Ecco.', '```grafico', '{"tipo":"barre","titolo":"Vendite","etichette":["gen","feb"],"serie":[{"nome":"2026","valori":[3,5]}],"unita":"k€"}', '```', 'Fine.', '<!--suggerimenti-->', '- prova A', '- prova B'].join("\n"));
	assert.equal(text.trim(), "Ecco.\n\nFine.");
	assert.deepEqual([...suggestions], ["prova A", "prova B"]);
	assert.equal(charts.length, 1);
	assert.equal(charts[0].type, "bar");
	assert.deepEqual([...charts[0].labels], ["gen", "feb"]);
});

test("charts: bars, horizontal bars and lines as SVG with title, axis values, legend and tooltips", () => {
	for (const type of ["bar", "hbar", "line"]) {
		const svg = chartSvg({ type, title: "Vendite", labels: ["gen", "feb", "mar"], series: [{ name: "2025", values: [3, 5, 4] }, { name: "2026", values: [4, 6, 7] }], unit: "k€" });
		assert.match(svg, /^<figure class="chart"/);
		assert.match(svg, /<svg[^>]+viewBox/);
		assert.match(svg, /Vendite/);
		assert.match(svg, /<title>2026 · mar: 7 k€<\/title>/);
		assert.match(svg, /class="legend".*2025.*2026/s);
	}
});

test("blocks: split at blank lines but never inside a fence or a list; same block → same cached HTML", () => {
	const { splitBlocks, answerBlocks } = context.window.PiRender;
	const text = "Titolo\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n1. uno\n\n2. due\n\nfine";
	assert.deepEqual([...splitBlocks(text)], ["Titolo", "```js\nconst a = 1;\n\nconst b = 2;\n```", "1. uno\n\n2. due", "fine"]);
	const first = answerBlocks(text).blocks;
	const second = answerBlocks(`${text} e altro`).blocks;
	assert.equal(second[0], first[0], "unchanged blocks are the cached strings");
	assert.notEqual(second[3], first[3]);
	assert.match(first[2], /<ol><li>uno<\/li><li>due<\/li><\/ol>/);
});
