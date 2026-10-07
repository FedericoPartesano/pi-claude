import { test } from "node:test";
import assert from "node:assert/strict";
import { PickerModel } from "../src/model.ts";
import type { PickerItem } from "../src/sources.ts";

const item = (label: string, extra: Partial<PickerItem> = {}): PickerItem => ({ value: label, label, ...extra });
const ENTRIES = [item(".env", { hidden: true }), item("src/", { enter: "src" }), item("readme.md"), item("package.json")];

test("hides hidden items until shown", () => {
	const model = new PickerModel("", false);
	model.setEntries(ENTRIES);
	assert.deepEqual(model.visible().map((entry) => entry.label), ["src/", "readme.md", "package.json"]);
	model.toggleHidden();
	assert.equal(model.visible().length, 4);
});

test("filters the search pool with a fuzzy query and resets the cursor", () => {
	const model = new PickerModel("", false);
	model.setEntries(ENTRIES, [...ENTRIES, item("src/deep/readme.md")]);
	model.move(2);
	model.type("rdm");
	assert.deepEqual(model.visible().map((entry) => entry.label), ["readme.md", "src/deep/readme.md"]);
	assert.equal(model.cursor, 0);
});

test("moves within bounds", () => {
	const model = new PickerModel("", false);
	model.setEntries(ENTRIES);
	model.move(-5);
	assert.equal(model.current()?.label, "src/");
	model.move(99);
	assert.equal(model.current()?.label, "package.json");
});

test("backspace edits the query, and asks to go up when the query is empty", () => {
	const model = new PickerModel("src", false);
	model.type("ab");
	assert.equal(model.backspace(), false);
	assert.equal(model.query, "a");
	model.backspace();
	assert.equal(model.backspace(), true);
});

test("single selection returns the current item", () => {
	const model = new PickerModel("", false);
	model.setEntries(ENTRIES);
	model.move(1);
	assert.deepEqual(model.result(), ["readme.md"]);
	assert.equal(model.toggle(), false); // no multi-selection
});

test("multi-selection keeps the order of selection and toggles off", () => {
	const model = new PickerModel("", true);
	model.setEntries(ENTRIES);
	model.move(2);
	model.toggle();
	model.move(-2);
	model.toggle();
	assert.deepEqual(model.result(), ["package.json", "src/"]);
	model.toggle();
	assert.deepEqual(model.result(), ["package.json"]);
});

test("multi-selection without marks returns the current item; empty lists return nothing", () => {
	const model = new PickerModel("", true);
	model.setEntries(ENTRIES);
	assert.deepEqual(model.result(), ["src/"]);
	model.setEntries([]);
	assert.equal(model.result(), undefined);
});

test("changing location clears the query and the cursor but keeps the selection", () => {
	const model = new PickerModel("", true);
	model.setEntries(ENTRIES);
	model.toggle();
	model.type("x");
	model.setLocation("src");
	assert.equal(model.location, "src");
	assert.equal(model.query, "");
	assert.equal(model.cursor, 0);
	assert.equal(model.selected.size, 1);
});
