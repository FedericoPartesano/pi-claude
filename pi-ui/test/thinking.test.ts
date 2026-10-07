import { test } from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_THINKING_LABEL, thinkingMarkdown } from "../src/thinking.ts";

test("folded thinking is one line that says how to open it (design 03, piegato)", () => {
	assert.match(HIDDEN_THINKING_LABEL, /^◇ penso ▸/);
	assert.match(HIDDEN_THINKING_LABEL, /ctrl\+t/);
});

test("open thinking: a '◇ penso ▾' header and the text in a │ gutter (design 03, espanso)", () => {
	const md = thinkingMarkdown("Leggo src/cart.js.\n\nIl reduce ignora qty.");
	assert.match(md, /^◇ \*\*penso\*\* ▾\n\n/);
	assert.match(md, /> Leggo src\/cart.js.\n>\n> Il reduce ignora qty./);
	assert.equal(thinkingMarkdown(thinkingMarkdown("x")), thinkingMarkdown("x"), "idempotent");
});

import { visibleWidth } from "@earendil-works/pi-tui";
import { renderThinkingBox } from "../src/thinking.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("live thinking box: at most the last 3 lines, dark and full width; nothing without text", () => {
	const text = Array.from({ length: 12 }, (_, i) => `Pensiero numero ${i + 1}, un po' lungo per andare a capo nel riquadro.`).join(" ");
	for (const width of [40, 80, 120]) {
		const box = renderThinkingBox(text, width);
		assert.ok(box.length > 0 && box.length <= 3, `${box.length} lines @${width}`);
		for (const line of box) assert.equal(visibleWidth(line), width);
		assert.match(box[0], /\x1b\[48;2;19;18;26m/, "panel background");
	}
	assert.match(strip(renderThinkingBox(text, 120).join(" ")), /numero 12, un po' lungo per andare a capo nel riquadro\.\s*$/);
	assert.deepEqual(renderThinkingBox("", 80), []);
	assert.deepEqual(renderThinkingBox("   \n ", 80), []);
	assert.equal(renderThinkingBox("Breve.", 80).length, 1);
	assert.match(strip(renderThinkingBox("**Grassetto** e `codice`", 80)[0]), /Grassetto e codice/);
});
