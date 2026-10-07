import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { C, fg, fit, label, pad } from "../src/palette.ts";

test("fit always fills exactly the width", () => {
	for (const width of [40, 80, 120]) {
		assert.equal(visibleWidth(fit("sinistra", "destra", width)), width);
		assert.equal(visibleWidth(fit(fg(C.mag, "x".repeat(200)), "destra", width)), width);
		assert.equal(visibleWidth(fit(label(C.cyan, " AL LAVORO "), fg(C.dim, "esc interrompi"), width)), width);
	}
});

test("fit drops the right part first when there is no room", () => {
	const line = fit("a".repeat(35), "destra molto lunga", 40);
	assert.equal(visibleWidth(line), 40);
	assert.doesNotMatch(line, /destra/);
});

test("pad never shortens", () => {
	assert.equal(pad("abc", 2), "abc");
	assert.equal(visibleWidth(pad("abc", 6)), 6);
});
