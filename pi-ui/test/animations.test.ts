import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { lastSentence, shimmer, wave } from "../src/animations.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("wave: a neon highlight that moves across fixed cells", () => {
	const frames = [0, 1, 2, 3].map((frame) => wave(frame, 6));
	for (const frame of frames) assert.equal(visibleWidth(frame), 6);
	assert.equal(new Set(frames.map(strip)).size > 1, true, "the highlight moves");
	assert.match(strip(frames[0]), /^[▰▱]{6}$/);
});

test("shimmer keeps the text and moves a brighter window over it", () => {
	const a = shimmer("Eseguo i test", 0);
	const b = shimmer("Eseguo i test", 5);
	assert.equal(strip(a), "Eseguo i test");
	assert.notEqual(a, b);
});

test("lastSentence: the latest complete thought, without markdown, short", () => {
	assert.equal(lastSentence("Leggo il file. **Poi** controllo i `casi` limite di paginate"), "Poi controllo i casi limite di paginate");
	assert.equal(lastSentence("Primo pensiero.\n\nSecondo pensiero completo."), "Secondo pensiero completo.");
	assert.equal(lastSentence(""), "");
	assert.ok(lastSentence("x".repeat(300)).length <= 90);
});
