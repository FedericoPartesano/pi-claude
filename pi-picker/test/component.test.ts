import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PickerComponent, type PickerTheme } from "../src/component.ts";
import { listSource, type PickerItem, type PickerSource } from "../src/sources.ts";

const plain: PickerTheme = { fg: (_color, text) => text, bold: (text) => text };
const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", escape: "\x1b", tab: "\t", space: " ", backspace: "\x7f", altH: "\x1bh" };

const ITEMS: PickerItem[] = [
	{ value: "src/", label: "src/", enter: "src" },
	{ value: "readme.md", label: "readme.md" },
	{ value: "package.json", label: "package.json" },
];

function tree(): PickerSource {
	return {
		start: "",
		list: (location) => (location === "" ? ITEMS : [{ value: "src/a.ts", label: "a.ts" }]),
		parent: (location) => (location === "" ? undefined : ""),
		describe: (location) => (location === "" ? "./" : `${location}/`),
	};
}

async function open(options: { source?: PickerSource; multi?: boolean; preview?: (item: PickerItem) => string | undefined } = {}) {
	const results: (string[] | undefined)[] = [];
	const picker = new PickerComponent({ title: "Prova", source: options.source ?? tree(), multi: options.multi, preview: options.preview, maxVisible: 5 }, plain, (result) => results.push(result), () => {});
	await picker.load();
	return { picker, results };
}

test("renders a box exactly as wide as the viewport, with title, location, query and items", async () => {
	const { picker } = await open();
	const lines = picker.render(80);
	for (const line of lines) assert.equal(visibleWidth(line), 80, JSON.stringify(line));
	const text = lines.join("\n");
	for (const expected of ["Prova", "./", "src/", "readme.md", "package.json", "Esc"]) assert.ok(text.includes(expected), expected);
	assert.equal(lines.length, picker.render(80).length); // stable height
});

test("shows the preview pane only on wide terminals", async () => {
	const { picker } = await open({ preview: (item) => `ANTEPRIMA ${item.label}` });
	assert.ok(!picker.render(80).join("\n").includes("ANTEPRIMA"));
	const wide = picker.render(120);
	for (const line of wide) assert.equal(visibleWidth(line), 120);
	assert.ok(wide.join("\n").includes("ANTEPRIMA src/"));
});

test("typing filters, arrows move, Enter returns the highlighted item", async () => {
	const { picker, results } = await open();
	for (const char of "json") picker.handleInput(char);
	assert.ok(!picker.render(80).join("\n").includes("readme.md"));
	picker.handleInput(KEYS.enter);
	assert.deepEqual(results, [["package.json"]]);
});

test("Esc cancels", async () => {
	const { picker, results } = await open();
	picker.handleInput(KEYS.escape);
	assert.deepEqual(results, [undefined]);
});

test("Tab enters a folder and Backspace on an empty query goes back up", async () => {
	const { picker, results } = await open();
	picker.handleInput(KEYS.tab);
	await picker.idle();
	assert.ok(picker.render(80).join("\n").includes("a.ts"));
	picker.handleInput(KEYS.backspace);
	await picker.idle();
	assert.ok(picker.render(80).join("\n").includes("readme.md"));
	assert.deepEqual(results, []);
});

test("Space marks several items in multi mode", async () => {
	const { picker, results } = await open({ multi: true });
	picker.handleInput(KEYS.down);
	picker.handleInput(KEYS.space);
	picker.handleInput(KEYS.down);
	picker.handleInput(KEYS.space);
	assert.ok(picker.render(80).join("\n").includes("2 selezionati"));
	picker.handleInput(KEYS.enter);
	assert.deepEqual(results, [["readme.md", "package.json"]]);
});

test("Alt+H shows hidden items", async () => {
	const { picker } = await open({ source: listSource([{ value: ".env", label: ".env", hidden: true }, { value: "a", label: "a" }]) });
	assert.ok(!picker.render(80).join("\n").includes(".env"));
	picker.handleInput(KEYS.altH);
	assert.ok(picker.render(80).join("\n").includes(".env"));
});

test("mouse click picks a row, wheel scrolls", async () => {
	const { picker, results } = await open();
	const lines = picker.render(80);
	const row = lines.findIndex((line) => line.includes("package.json"));
	picker.handleMouse({ type: "wheel", button: "none", x: 5, y: row, screenX: 5, screenY: row, width: 80, height: lines.length, shift: false, alt: false, ctrl: false, wheelDelta: 1 });
	picker.handleMouse({ type: "click", button: "left", x: 5, y: row, screenX: 5, screenY: row, width: 80, height: lines.length, shift: false, alt: false, ctrl: false, clickCount: 1 });
	assert.deepEqual(results, [["package.json"]]);
});
