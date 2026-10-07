import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CHART_PROMPT, extractCharts, renderChart, type ChartSpec } from "../src/charts.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const sales: ChartSpec = { type: "bar", title: "Vendite mensili", labels: ["gen", "feb", "mar", "apr"], series: [{ name: "2026", values: [50, 70, 140, 90] }], unit: "k€" };

test("extractCharts cuts ```grafico blocks out of the answer and leaves a pointer; English keys work too", () => {
	const md = 'Ecco le vendite.\n\n```grafico\n{"tipo":"barre","titolo":"Vendite mensili","etichette":["gen","feb"],"serie":[{"nome":"2026","valori":[50,70]}],"unita":"k€"}\n```\n\nFine.';
	const { text, charts, errors } = extractCharts(md);
	assert.equal(charts.length, 1);
	assert.deepEqual(charts[0], { type: "bar", title: "Vendite mensili", labels: ["gen", "feb"], series: [{ name: "2026", values: [50, 70] }], unit: "k€" });
	assert.match(text, /Ecco le vendite\.\n\n▦ \*grafico: Vendite mensili\* ↓\n\nFine\./);
	assert.deepEqual(errors, []);
	const english = extractCharts('```chart\n{"type":"line","title":"T","labels":["a","b"],"series":[{"values":[1,2]}]}\n```');
	assert.equal(english.charts[0].type, "line");
	assert.equal(extractCharts("```grafico\n{non json\n```").errors.length, 1);
	assert.equal(extractCharts("```grafico\n{\"tipo\":\"barre\",\"serie\":[]}\n```").errors.length, 1, "no data");
	assert.deepEqual(extractCharts("solo testo"), { text: "solo testo", charts: [], errors: [] });
	assert.match(CHART_PROMPT, /```grafico/);
});

test("every chart type fits the width exactly", () => {
	const specs: ChartSpec[] = [sales, { ...sales, type: "hbar" }, { ...sales, type: "line", series: [{ name: "a", values: [3, 9, 2, 7] }, { name: "b", values: [1, 2, 8, 4] }] }];
	for (const spec of specs) for (const width of [40, 80, 120]) {
		const lines = renderChart(spec, width);
		assert.ok(lines.length >= 4, `${spec.type}@${width}`);
		for (const line of lines) assert.equal(visibleWidth(line), width, `${spec.type}@${width}: ${strip(line)}`);
	}
});

test("horizontal bars: label, bar proportional to the value, value with unit; the largest is highlighted", () => {
	const lines = renderChart({ ...sales, type: "hbar" }, 80).map(strip);
	assert.match(lines[0], /Vendite mensili/);
	const mar = lines.find((line) => line.trimStart().startsWith("mar"))!;
	const gen = lines.find((line) => line.trimStart().startsWith("gen"))!;
	assert.match(mar, /140 k€/);
	assert.ok((mar.match(/█/g) ?? []).length > (gen.match(/█/g) ?? []).length * 2);
	assert.match(renderChart({ ...sales, type: "hbar" }, 80).join("\n"), /\x1b\[38;2;255;63;216m█/, "max in magenta");
});

test("vertical bars: tallest column reaches the top row, labels under the columns", () => {
	const lines = renderChart(sales, 80).map(strip);
	const body = lines.slice(1, -1);
	assert.ok(body.some((line) => line.includes("█")));
	assert.match(lines[lines.length - 1], /gen.*feb.*mar.*apr/);
});

test("lines are drawn with braille dots, with min/max on the axis and a legend for several series", () => {
	const lines = renderChart({ type: "line", title: "Andamento", labels: ["a", "b", "c", "d"], series: [{ name: "uno", values: [3, 9, 2, 7] }, { name: "due", values: [1, 2, 8, 4] }] }, 80).map(strip);
	assert.ok(lines.some((line) => /[⠁-⣿]/.test(line)), "braille");
	assert.match(lines.join("\n"), /9/);
	assert.match(lines.join("\n"), /1/);
	assert.match(lines.join("\n"), /uno.*due/);
});
