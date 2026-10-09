import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, markdown, chartSvg, extract } from "../renderer/src/render.ts";

test("code is highlighted by language (diff and sql included); unknown languages stay plain and escaped", () => {
	const ts = markdown("```ts\nconst x: number = 1; // nota\n```");
	assert.match(ts, /<span class="hljs-keyword">const<\/span>/);
	assert.match(ts, /hljs-comment/);
	assert.match(markdown("```diff\n- vecchio\n+ nuovo\n```"), /hljs-deletion.*hljs-addition/s);
	assert.match(markdown("```sql\nSELECT * FROM t WHERE a = 1\n```"), /hljs-keyword">SELECT/);
	assert.match(markdown("```boh\n<b>x</b>\n```"), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("callouts: GitHub [!NOTE]…[!CAUTION] and the Italian words, with a title", () => {
	const note = markdown("> [!WARNING]\n> Il backup **non** è stato fatto.");
	assert.match(note, /<div class="callout warning">/);
	assert.match(note, /Attenzione/);
	assert.match(note, /<strong>non<\/strong>/);
	assert.match(markdown("> [!SUGGERIMENTO] Usa la cache"), /class="callout tip".*Usa la cache/s);
	assert.match(markdown("> solo una citazione"), /<blockquote>/);
});

test("task lists, display math, inline math; a dollar amount is not math", () => {
	const tasks = markdown("- [x] fatto\n- [ ] da fare");
	assert.match(tasks, /<li class="task done"><span class="check">✓<\/span> fatto<\/li>/);
	assert.match(tasks, /<li class="task"><span class="check"><\/span> da fare<\/li>/);
	assert.match(markdown("$$\nE = mc^2\n$$"), /<div class="math" data-tex="E = mc\^2" data-display="1">/);
	assert.match(markdown("la formula \\(a^2 + b^2\\) vale"), /<span class="math" data-tex="a\^2 \+ b\^2">/);
	assert.ok(!/class="math"/.test(markdown("costa $5 e $10")));
});

test("mermaid: a placeholder rendered later, only once the block is complete", () => {
	assert.match(markdown("```mermaid\ngraph TD; A-->B\n```"), /<div class="mermaid" data-src="graph TD; A--&gt;B" data-complete="1">/);
	assert.match(markdown("```mermaid\ngraph TD; A-->"), /data-complete="0"/, "still streaming");
});

test("charts: pie, donut, area and stacked bars; KPI cards from a ```kpi block", () => {
	const spec = { labels: ["A", "B", "C"], series: [{ name: "x", values: [3, 2, 5] }, { name: "y", values: [1, 4, 2] }], unit: "", title: "T" };
	assert.match(chartSvg({ ...spec, type: "pie" }), /<path[^>]+d="M/);
	assert.match(chartSvg({ ...spec, type: "pie" }), /<title>A: 3 \(30%\)<\/title>/);
	assert.match(chartSvg({ ...spec, type: "donut" }), /class="donut-hole"|<circle[^>]+fill="var\(--surface/);
	assert.match(chartSvg({ ...spec, type: "area" }), /<path class="area"/);
	const stacked = chartSvg({ ...spec, type: "stacked" });
	assert.match(stacked, /<title>y · B: 4<\/title>/);
	const { charts } = extract('```grafico\n{"tipo":"torta","etichette":["a"],"serie":[{"valori":[1]}]}\n```\n```grafico\n{"tipo":"barre-impilate","etichette":["a"],"serie":[{"valori":[1]}]}\n```');
	assert.deepEqual(charts.map((chart) => chart.type), ["pie", "stacked"]);
	const kpi = answer('```kpi\n[{"etichetta":"Copertura","valore":"92%","variazione":"+12%","tono":"ok"},{"etichetta":"Errori","valore":"3","variazione":"-2","tono":"err","nota":"ultima settimana"}]\n```').html;
	assert.match(kpi, /<div class="kpis">/);
	assert.match(kpi, /<div class="kpi ok">.*Copertura.*92%.*\+12%/s);
	assert.match(kpi, /class="kpi err".*ultima settimana/s);
});

test("$$…$$ in the middle of a line is a formula too", () => {
	assert.match(markdown("resta $$O(n \\log n)$$ in media"), /<span class="math" data-tex="O\(n \\log n\)">/);
});
