import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
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

test("night-city: cyberpunk colors and the HUD style (block tags, cut corners, numbered sections)", async () => {
	const { renderStatusBar } = await import("../src/status-bar.ts");
	const { frameEditor } = await import("../src/editor.ts");
	const { renderPanel } = await import("../src/panel.ts");
	const { initialStatus } = await import("../src/status.ts");
	const theme = JSON.parse(readFileSync(new URL("../themes/night-city.json", import.meta.url), "utf8"));
	assert.equal(theme.name, "night-city");
	assert.equal(theme.vars.mag, "#FCEE0A");
	usePalette("night-city");
	assert.equal(C.mag, "#FCEE0A");
	const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
	assert.match(strip(renderStatusBar(initialStatus(), 80, 0, 0)), /▐ PRONTO ▌/);
	const framed = frameEditor(["top", "text", "bottom"], 40, false).map(strip);
	assert.ok(framed[0].endsWith("◣") && framed[2].startsWith("◥"));
	const panel = renderPanel({ session: new Map(), files: [], failures: [], usage: { model: "m", thinking: "t" } }, 40).map(strip);
	assert.match(panel[0], /SYS\/\/PANNELLO/);
	assert.ok(panel.some((line) => /\/\/ 01 .*SESSIONE/.test(line)));
	assert.ok(panel.some((line) => /SYS OK/.test(line)));
	for (const line of panel) assert.equal(visibleWidth(line), 40);
	usePalette("lilla");
	assert.doesNotMatch(strip(renderStatusBar(initialStatus(), 80, 0, 0)), /▐/, "no HUD outside night-city");
	usePalette("neon-night");
});
