import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserColumn, type BrowserInput } from "../src/browser-column.ts";

const event = (over: Record<string, unknown>) => ({ type: "click", button: "left", x: 0, y: 1, screenX: 0, screenY: 1, width: 62, height: 30, shift: false, alt: false, ctrl: false, ...over }) as never;

test("a click on the picture becomes a position in the page; the title line and the margin do not", () => {
	const column = new BrowserColumn(() => {});
	const got: BrowserInput[] = [];
	column.handler = (input) => got.push(input);
	(column as unknown as { rows: number }).rows = 20;
	assert.equal(column.handleMouse(event({ y: 0 })), undefined, "title line");
	const result = column.handleMouse(event({ x: 30, y: 11 }));
	assert.equal(result?.focus, true, "a click gives the keys to the page");
	assert.deepEqual(got, [{ type: "click", fx: 0.5, fy: 0.525 }]);
	assert.equal(column.handleMouse(event({ x: 61, y: 5 })), undefined, "right margin");
});

test("wheel scrolls without taking the keys; Esc hands the keyboard back, other keys go to the page", () => {
	let focus: unknown = "unset";
	const before = { name: "editor" };
	const host = { getFocusedComponent: () => before as never, setFocus: (component: unknown) => (focus = component) };
	const column = new BrowserColumn(() => {}, () => host as never);
	const got: BrowserInput[] = [];
	column.handler = (input) => got.push(input);
	(column as unknown as { rows: number }).rows = 10;
	assert.equal(column.handleMouse(event({ type: "wheel", button: "none", x: 10, y: 3, wheelDelta: 2 }))?.focus, undefined);
	assert.deepEqual(got[0], { type: "wheel", fx: 10 / 60, fy: 0.25, deltaY: 120 });
	column.handleMouse(event({ x: 10, y: 3 }));
	column.handleInput("a");
	assert.deepEqual(got.at(-1), { type: "key", data: "a" });
	column.handleInput("\x1b");
	assert.equal(focus, before, "Esc gives the focus back to what had it");
});
