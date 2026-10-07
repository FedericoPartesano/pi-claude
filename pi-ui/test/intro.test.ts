import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { INTRO_MS, introFrame, logoFor } from "../src/intro.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("the big logo spells PI//CLAUDE in shadow blocks; narrow terminals get a compact one", () => {
	const big = logoFor(120);
	assert.equal(big.length, 6);
	assert.ok(big.every((line) => line.length === big[0].length), "all rows same width");
	assert.ok(big[0].length <= 80);
	assert.match(big.join("\n"), /██████╗/);
	assert.ok(logoFor(60).length < 6, "compact under 80 columns");
});

test("frames fit the terminal and settle on the clean logo with the subtitle", () => {
	const options = { width: 120, height: 30, subtitle: "pi-full · progetto ⎇ main", palette: ["#ff3fd8", "#2ee6ff"] as [string, string], seed: 1 };
	for (const at of [0, 200, 600, 1200, INTRO_MS]) {
		const lines = introFrame(at, options);
		assert.equal(lines.length, 30);
		for (const line of lines) assert.ok(visibleWidth(line) <= 120, `${at}ms: ${visibleWidth(line)}`);
	}
	const end = introFrame(INTRO_MS, options).map(strip).join("\n");
	for (const row of logoFor(120)) assert.ok(end.includes(row), "logo fully resolved at the end");
	assert.match(end, /pi-full · progetto ⎇ main/);
	const start = introFrame(0, options).map(strip).join("\n");
	assert.ok(!logoFor(120).every((row) => start.includes(row)), "still scrambled at the start");
	assert.match(end, /╭─[\s\S]*─╯/, "HUD brackets around the logo");
	assert.match(end, /[·+✦]/, "starfield in the background");
	assert.notEqual(introFrame(700, options).join(""), introFrame(900, options).join(""), "the shine moves");
});
