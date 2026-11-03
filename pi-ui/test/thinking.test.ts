import { test } from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_THINKING_LABEL, thinkingMarkdown } from "../src/thinking.ts";

test("folded thinking is one line that says how to open it (design 03, piegato)", () => {
	assert.match(HIDDEN_THINKING_LABEL, /^◇ penso ▸/);
	assert.match(HIDDEN_THINKING_LABEL, /ctrl\+t/);
});

test("open thinking: a '◇ penso ▾' header and the text in a │ gutter (design 03, espanso)", () => {
	const md = thinkingMarkdown("Leggo src/cart.js.\n\nIl reduce ignora qty.");
	assert.match(md, /^◇ \*\*penso\*\* ▾ · 6 parole\n\n/);
	assert.match(md, /> Leggo src\/cart.js.\n>\n> Il reduce ignora qty./);
	assert.match(thinkingMarkdown("a\nb"), /> a b$/, "single newlines join");
	assert.equal(thinkingMarkdown(thinkingMarkdown("x")), thinkingMarkdown("x"), "idempotent");
});

import { visibleWidth } from "@earendil-works/pi-tui";
import { renderThinkingBox } from "../src/thinking.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("live thinking box: header plus at most 5 lines, dark and full width; nothing without text", () => {
	const text = Array.from({ length: 12 }, (_, i) => `Pensiero numero ${i + 1}, un po' lungo per andare a capo nel riquadro.`).join(" ");
	for (const width of [40, 80, 120]) {
		const box = renderThinkingBox(text, width);
		assert.ok(box.length > 1 && box.length <= 6, `${box.length} lines @${width}`);
		for (const line of box) assert.equal(visibleWidth(line), width);
		assert.match(box[0], /\x1b\[48;2;19;18;26m/, "panel background");
		assert.match(strip(box[0]), /penso · \d+ parole/);
	}
	assert.match(strip(renderThinkingBox(text, 120).join(" ")), /numero 12, un po' lungo per andare a capo nel riquadro\.\s*$/);
	assert.deepEqual(renderThinkingBox("", 80), []);
	assert.deepEqual(renderThinkingBox("   \n ", 80), []);
	assert.equal(renderThinkingBox("Breve.", 80).length, 2);
	assert.match(strip(renderThinkingBox("**Grassetto** e `codice`", 80)[1]), /Grassetto e codice/);
});

import { closedLabel, patchClosedLabel, thinkingGist } from "../src/thinking.ts";

test("closed label: words and first sentence; generic without text", () => {
	assert.equal(thinkingGist("Controllo come gestisce la coda. Poi altro."), "Controllo come gestisce la coda.");
	assert.match(closedLabel("Controllo la coda. Poi altro."), /^◇ penso ▸ 5 parole · Controllo la coda\.  ctrl\+t apre$/);
	assert.equal(closedLabel(""), HIDDEN_THINKING_LABEL);
});

test("patchClosedLabel sets the label per message, once", () => {
	let seen = "";
	const proto = { updateContent(this: { hiddenThinkingLabel: string }) { seen = this.hiddenThinkingLabel; } };
	assert.equal(patchClosedLabel(proto as never), true);
	assert.equal(patchClosedLabel(proto as never), false);
	const obj = Object.assign(Object.create(proto), { hiddenThinkingLabel: HIDDEN_THINKING_LABEL });
	obj.updateContent({ content: [{ type: "thinking", thinking: "Leggo il file. Dopo scrivo." }] });
	assert.match(seen, /parole · Leggo il file\./);
});
