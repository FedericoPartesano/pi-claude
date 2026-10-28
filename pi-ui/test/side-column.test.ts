import { test } from "node:test";
import assert from "node:assert/strict";
import type { Component } from "@earendil-works/pi-tui";
import { SideColumn } from "../src/side-column.ts";

const part = (name: string, log: string[] = []): Component => ({ render: () => [name], handleInput: (data) => void log.push(`${name}:${data}`), invalidate() {} });

function host() {
	let focused: Component | null = part("editor");
	return { getFocusedComponent: () => focused, setFocus: (component: Component | null) => void (focused = component), current: () => focused };
}

test("open does not take the keyboard; a click does, blur and close hand it back", () => {
	const tui = host();
	const editor = tui.current();
	const keys: string[] = [];
	let redraws = 0;
	let closed = 0;
	const column = new SideColumn(() => redraws++, () => tui);
	const clickable: Component = { ...part("micelio", keys), handleMouse: () => ({ handled: true, focus: true }) };
	column.open(clickable, { width: 50, onClose: () => closed++ });
	assert.equal(column.active, true);
	assert.equal(column.width, 50);
	assert.deepEqual(column.render(50), ["micelio"]);
	assert.equal(tui.current(), editor); // the chat keeps the keyboard
	assert.equal(column.handleMouse({ type: "click" } as never)?.focus, true); // a click asks for the keys
	tui.setFocus(column); // what Pi does with that answer
	column.handleInput("x");
	assert.deepEqual(keys, ["micelio:x"]);
	column.blur();
	assert.equal(tui.current(), editor);
	assert.equal(column.active, true); // blur leaves the column open
	column.handleMouse({ type: "click" } as never);
	tui.setFocus(column);
	column.close();
	assert.equal(column.active, false);
	assert.equal(tui.current(), editor);
	assert.equal(closed, 1);
	assert.deepEqual(column.render(50), []);
	assert.ok(redraws >= 2);
});

test("closing a column that is not open does nothing", () => {
	let closed = 0;
	new SideColumn(() => {}, host).close();
	const column = new SideColumn(() => {}, host);
	column.open(part("a"), { onClose: () => closed++ });
	column.close();
	column.close();
	assert.equal(closed, 1);
});

test("focus moves the keyboard in by key, blur gives it back", () => {
	const tui = host();
	const editor = tui.current();
	const column = new SideColumn(() => {}, () => tui);
	column.focus(); // closed: nothing happens
	assert.equal(tui.current(), editor);
	column.open(part("micelio"));
	assert.equal(column.isFocused(), false);
	column.focus();
	assert.equal(column.isFocused(), true);
	assert.equal(tui.current(), column);
	column.blur();
	assert.equal(tui.current(), editor);
});
