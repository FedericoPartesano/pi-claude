import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseNumstat, parsePorcelain, renderPanel, type PanelInfo } from "../src/panel.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const info: PanelInfo = {
	session: new Map([["goal", "goal 2/5"], ["loop", "loop 5m · giro 3 · prossimo 04:12"], ["team", "team t2/4 tester"]]),
	files: [{ status: "M", path: "src/cart.js", added: 1, removed: 1 }, { status: "A", path: "test/cart.test.js", added: 18, removed: 0 }],
	failures: ["totalValue · test/cart.test.js:12 · ricevuto 29.9, atteso 59.8"],
	image: { ref: "out/vendite.png", lines: ["\x1b[38;2;1;2;3m\x1b[48;2;4;5;6m▀\x1b[0m".repeat(36)] },
	usage: { fiveHour: 0.34, sevenDay: 0.18, contextPercent: 41, contextTokens: 82_000, contextWindow: 200_000, model: "sonnet", thinking: "medium" },
};

test("the panel lists session, files, failing tests, last image and usage at its exact width", () => {
	const lines = renderPanel(info, 40, "alt+s");
	for (const line of lines) assert.equal(visibleWidth(line), 40);
	const text = lines.map(strip).join("\n");
	assert.match(text, /PANNELLO\s+alt\+s chiudi/);
	assert.match(renderPanel(info, 40, "f2").map(strip)[0], /f2 chiudi/);
	assert.match(text, /GOAL 2\/5/);
	assert.match(text, /LOOP 5m · giro 3/);
	assert.match(text, /TEAM t2\/4 tester/);
	assert.match(text, /FILE ─+ ✚2/);
	assert.match(text, /M src\/cart.js\s+\+1 -1/);
	assert.match(text, /A test\/cart.test.js\s+\+18/);
	assert.match(text, /TEST ─+ 1 ✗/);
	assert.match(text, /✗ totalValue/);
	assert.match(text, /IMMAGINI/);
	assert.match(text, /5H\s+▰+▱+ 34%/);
	assert.match(text, /CTX\s+▰+▱+ 41%/);
	assert.match(text, /82k\/200k · sonnet·medium/);
});

test("empty sections are left out", () => {
	const text = renderPanel({ ...info, session: new Map(), files: [], failures: [], image: undefined }, 40, "alt+s").map(strip).join("\n");
	assert.match(text, /nessun goal, loop o team/);
	assert.doesNotMatch(text, /FILE|TEST|IMMAGINI/);
	assert.match(text, /USO/);
});

test("git porcelain and numstat parsing", () => {
	assert.deepEqual(parsePorcelain(" M src/a.js\n?? new.txt\nR  old.js -> new.js\n D gone.js\n"), [
		{ status: "M", path: "src/a.js" },
		{ status: "A", path: "new.txt" },
		{ status: "R", path: "new.js" },
		{ status: "D", path: "gone.js" },
	]);
	assert.deepEqual(parseNumstat("1\t1\tsrc/a.js\n-\t-\timg.png\n"), new Map([["src/a.js", { added: 1, removed: 1 }], ["img.png", { added: 0, removed: 0 }]]));
});
