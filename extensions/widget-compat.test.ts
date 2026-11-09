import assert from "node:assert/strict";
import test from "node:test";
import { setWidgetCompat } from "./widget-compat.ts";

test("tui mode passes the factory through", () => {
	const calls: unknown[][] = [];
	let tui: unknown;
	setWidgetCompat({ mode: "tui", ui: { setWidget: (...a) => calls.push(a) } }, "k", () => ({ render: () => ["x"] }), { placement: "aboveEditor" }, (t) => (tui = t));
	assert.equal(typeof calls[0][1], "function");
	const fake = { requestRender() {} };
	(calls[0][1] as (t: unknown) => unknown)(fake);
	assert.equal(tui, fake);
});

test("rpc mode renders lines and sends them only when they change", async () => {
	const calls: unknown[][] = [];
	let lines = ["a"];
	let tui: { requestRender(): void } | undefined;
	setWidgetCompat({ mode: "rpc", ui: { setWidget: (...a) => calls.push(a) } }, "k", () => ({ render: () => lines }), undefined, (t) => (tui = t));
	tui?.requestRender();
	tui?.requestRender();
	await new Promise((r) => setTimeout(r, 300));
	assert.deepEqual(calls, [["k", ["a"]]]);
	tui?.requestRender();
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(calls.length, 1);
	lines = [];
	tui?.requestRender();
	await new Promise((r) => setTimeout(r, 300));
	assert.deepEqual(calls[1], ["k", undefined]);
});
