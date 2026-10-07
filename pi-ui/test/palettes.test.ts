import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderChart } from "../src/charts.ts";
import { renderFooter } from "../src/footer.ts";
import { C, PALETTES, usePalette } from "../src/palette.ts";

const ansi = (hex: string) => `38;2;${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";")}m`;

test("the palette follows Pi's theme: neon-night, lilla (the WezTerm pastels), neon for anything else", () => {
	assert.equal(usePalette("lilla"), true);
	assert.equal(C.mag, "#AE95C7");
	assert.equal(C.bg, "#1C2023");
	assert.equal(usePalette("lilla"), false, "no change, no work");
	usePalette("neon-night");
	assert.equal(C.mag, "#ff3fd8");
	usePalette("dark");
	assert.equal(C.mag, PALETTES["neon-night"].mag);
});

test("renderers pick up a palette switch (no colors frozen at load)", () => {
	usePalette("lilla");
	const footer = renderFooter({ statuses: new Map([["goal", "goal 1/5"]]), project: "p", changes: 0, model: "sonnet", thinking: "medium" }, 80);
	assert.ok(footer.includes(ansi("#AE95C7")), "GOAL in lilla");
	const chart = renderChart({ type: "line", labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [2, 1] }] }, 60).join("");
	assert.ok(chart.includes(ansi(PALETTES.lilla.cyan)), "series colors from the lilla palette");
	usePalette("neon-night");
});

test("the lilla Pi theme exists and uses the WezTerm background and accent", () => {
	const theme = JSON.parse(readFileSync(new URL("../themes/lilla.json", import.meta.url), "utf8"));
	assert.equal(theme.name, "lilla");
	assert.equal(theme.vars.bg, "#1C2023");
	assert.equal(theme.vars.mag, "#AE95C7");
});
