import { test } from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_THINKING_LABEL, clampThinkingLines, thinkingMarkdown } from "../src/thinking.ts";

test("folded thinking is one line that says how to open it (design 03, piegato)", () => {
	assert.match(HIDDEN_THINKING_LABEL, /^◇ thinking ▸/);
	assert.match(HIDDEN_THINKING_LABEL, /ctrl\+t/);
});

test("open thinking: a '◇ thinking ▾' header and the text in a │ gutter (design 03, espanso)", () => {
	const md = thinkingMarkdown("Leggo src/cart.js.\n\nIl reduce ignora qty.");
	assert.match(md, /^◇ \*\*thinking\*\* ▾ · 6 words\n\n/);
	assert.match(md, /> Leggo src\/cart.js.\n>\n> Il reduce ignora qty./);
	assert.match(thinkingMarkdown("a\nb"), /> a b$/, "single newlines join");
	assert.equal(thinkingMarkdown(thinkingMarkdown("x")), thinkingMarkdown("x"), "idempotent");
});

import { visibleWidth } from "@earendil-works/pi-tui";
import { ThinkingRate, renderThinkingBox, neuralWave, sparkline } from "../src/thinking.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("live thinking box: header plus at most 5 lines, dark and full width; nothing without text", () => {
	const text = Array.from({ length: 12 }, (_, i) => `Pensiero numero ${i + 1}, un po' lungo per andare a capo nel riquadro.`).join(" ");
	for (const width of [40, 80, 120]) {
		const box = renderThinkingBox(text, width);
		assert.ok(box.length > 1 && box.length <= 6, `${box.length} lines @${width}`);
		for (const line of box) assert.equal(visibleWidth(line), width);
		assert.match(box[0], /\x1b\[48;2;19;18;26m/, "panel background");
		assert.match(strip(box[0]), /thinking · \d+ words/);
	}
	assert.match(strip(renderThinkingBox(text, 120).join(" ")), /numero 12, un po' lungo per andare a capo nel riquadro\.▍?\s*$/);
	assert.deepEqual(renderThinkingBox("", 80), []);
	assert.deepEqual(renderThinkingBox("   \n ", 80), []);
	assert.equal(renderThinkingBox("Breve.", 80).length, 2);
	assert.match(strip(renderThinkingBox("**Grassetto** e `codice`", 80)[1]), /Grassetto e codice/);
});

import { closedLabel, patchClosedLabel, thinkingGist } from "../src/thinking.ts";

test("closed label: words and first sentence; generic without text", () => {
	assert.equal(thinkingGist("Controllo come gestisce la coda. Poi altro."), "Controllo come gestisce la coda.");
	assert.match(closedLabel("Controllo la coda. Poi altro."), /^◇ thinking ▸ 5 words · Controllo la coda\.  ctrl\+t opens$/);
	assert.equal(closedLabel(""), HIDDEN_THINKING_LABEL);
});

test("patchClosedLabel sets the label per message, once", () => {
	let seen = "";
	const proto = { updateContent(this: { hiddenThinkingLabel: string }) { seen = this.hiddenThinkingLabel; } };
	assert.equal(patchClosedLabel(proto as never), true);
	assert.equal(patchClosedLabel(proto as never), false);
	const obj = Object.assign(Object.create(proto), { hiddenThinkingLabel: HIDDEN_THINKING_LABEL });
	obj.updateContent({ content: [{ type: "thinking", thinking: "Leggo il file. Dopo scrivo." }] });
	assert.match(seen, /words · Leggo il file\./);
});

import { thinkingShown } from "../src/thinking.ts";

test("thinkingShown follows Pi's open/closed state, so the live box does not repeat open thinking", () => {
	const proto = { updateContent() {} };
	patchClosedLabel(proto as never);
	const open = Object.assign(Object.create(proto), { hideThinkingBlock: false, hiddenThinkingLabel: HIDDEN_THINKING_LABEL });
	open.updateContent({ content: [] });
	assert.equal(thinkingShown(), true);
	const folded = Object.assign(Object.create(proto), { hideThinkingBlock: true, hiddenThinkingLabel: HIDDEN_THINKING_LABEL });
	folded.updateContent({ content: [] });
	assert.equal(thinkingShown(), false);
});


test("clampThinkingLines: header plus the last 5 text lines of the real layout; whole when expanded or short", () => {
	const lines = ["◇ thinking ▾ · 90 words", "", ...Array.from({ length: 12 }, (_, i) => `│ line ${i + 1}`)];
	const clipped = clampThinkingLines(lines, false);
	assert.equal(clipped.length, 7);
	assert.match(clipped[0], /last 5 lines \(\+7 above, \/thinking opens all\)/);
	assert.deepEqual(clipped.slice(-5).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")), ["│ line 8", "│ line 9", "│ line 10", "│ line 11", "│ line 12"]);
	const padded = clampThinkingLines(["◇ thinking ▾ · 9 words" + " ".repeat(40), "", ...lines.slice(2)], false);
	assert.equal(strip(padded[0]).length < 100, true, "header padding dropped");
	assert.deepEqual(clampThinkingLines(lines, true), lines);
	const short = ["◇ thinking ▾ · 5 words", "", "│ a", "│ b"];
	assert.deepEqual(clampThinkingLines(short, false), short);
	assert.deepEqual(clampThinkingLines(["plain", "text"], false), ["plain", "text"]);
});

test("patchClosedLabel also clamps the rendered children of the message", () => {
	const proto = { updateContent() {} };
	patchClosedLabel(proto as never);
	const long = ["◇ thinking ▾ · 90 words", "", ...Array.from({ length: 9 }, (_, i) => `│ l${i}`)];
	const child = { render: () => long };
	const message = Object.assign(Object.create(proto), { hiddenThinkingLabel: "x", contentContainer: { children: [child] } });
	message.updateContent({ content: [] });
	assert.equal(child.render().length, 1 + 1 + 5);
});

test("neuralWave: fixed width, moves between steps; sparkline: shape of the sentences", () => {
	assert.equal([...neuralWave(20, 0)].length, 20);
	assert.notEqual(neuralWave(20, 0), neuralWave(20, 4));
	assert.equal(neuralWave(20, 0), neuralWave(20, 1), "calm: two frames share a step");
	assert.equal(sparkline("Uno. Due parole qui. Ora una frase lunga con molte più parole del dovuto per salire."), "▁▂█");
	assert.equal(sparkline("Una sola frase"), "");
	assert.match(closedLabel("Uno. Due parole qui. Ora una frase lunga con molte più parole."), /words [▁-█]+ ·/);
});

test("thinking box: wave in the header, cursor on the last line, never wider than the width", () => {
	for (const frame of [0, 4, 9]) {
		for (const row of renderThinkingBox("Leggo il file. Poi cerco l'errore nel reduce che ignora qty e ricalcolo il totale.", 60, { seconds: 3, frame })) {
			assert.ok(visibleWidth(row) <= 60, `${visibleWidth(row)} > 60`);
		}
	}
	assert.match(strip(renderThinkingBox("Leggo il file.", 60, { frame: 0 })[0]), /[▁-█]{8,}/);
	assert.match(strip(renderThinkingBox("Leggo il file.", 60, { frame: 0 })[1]), /▍/);
});

test("ThinkingRate: level follows the flow, decays when text stops, phase never goes back", () => {
	const rate = new ThinkingRate();
	let text = "";
	let phase = 0;
	for (let t = 0; t <= 3000; t += 100) {
		text += "x".repeat(30); // 300 chars a second
		rate.push(text, t);
		const flow = rate.sample(t);
		assert.ok(flow.phase >= phase);
		phase = flow.phase;
	}
	assert.ok(rate.level() > 0.8, `level ${rate.level()}`);
	assert.ok(rate.sample(9000).level < 0.1, "decays when nothing arrives");
	rate.reset();
	assert.equal(rate.level(), 0);
});

test("neuralWave with a flow: flat when idle, wider range when it pours", () => {
	const range = (wave: string) => Math.max(...[...wave].map((c) => "▁▂▃▄▅▆▇█".indexOf(c))) - Math.min(...[...wave].map((c) => "▁▂▃▄▅▆▇█".indexOf(c)));
	assert.ok(range(neuralWave(24, 0, { level: 0, phase: 3 })) <= 1);
	assert.ok(range(neuralWave(24, 0, { level: 1, phase: 3 })) >= 5);
	assert.notEqual(neuralWave(24, 0, { level: 1, phase: 3 }), neuralWave(24, 0, { level: 1, phase: 3.5 }));
});
