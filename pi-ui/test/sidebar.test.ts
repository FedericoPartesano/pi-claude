import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_NODE, sidebarRoot, sidebarWidth } from "../src/sidebar.ts";

test("the pinned panel takes a real column from 120 terminal columns; otherwise nothing is reserved", () => {
	assert.equal(sidebarWidth(140, true, 40), 41);
	assert.equal(sidebarWidth(119, true, 40), 0);
	assert.equal(sidebarWidth(200, false, 40), 0);
});

test("the fullscreen layout root becomes an hstack: the chat grows, the panel has a fixed width and shows only when wide", () => {
	const chat = { render: (width: number) => [`chat ${width}`], invalidate() {} };
	const panel = { render: (width: number) => [`panel ${width}`], invalidate() {} };
	const root = sidebarRoot(chat, panel, 41);
	assert.equal(LAYOUT_NODE, Symbol.for("@earendil-works/pi-tui/layout-node"));
	const node = root[LAYOUT_NODE]();
	assert.equal(node.type, "hstack");
	assert.equal(node.entries[0].component, chat);
	assert.equal(node.entries[0].grow, 1);
	assert.equal(node.entries[0].basis, 0, "a numeric basis: the layout never measures the chat at full width (that doubled the Markdown work on each keystroke)");
	assert.equal(node.entries[1].component, panel);
	assert.equal(node.entries[1].basis, 41);
	assert.equal(node.entries[1].visible?.({ width: 160, height: 40 }), true);
	assert.equal(node.entries[1].visible?.({ width: 100, height: 40 }), false);
	assert.deepEqual(root.render(80), ["chat 80"], "outside the layout engine (transcript export) it renders the chat");
	assert.equal(root.inner, chat);
});
