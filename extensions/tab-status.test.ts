import assert from "node:assert/strict";
import { test } from "node:test";
import tabStatus, { FRAMES, IDLE, tabTitle } from "./tab-status.ts";

function setup() {
	const handlers: Record<string, (e: unknown, c: unknown) => void> = {};
	const titles: string[] = [];
	tabStatus({ on: (name: string, fn: (e: unknown, c: unknown) => void) => (handlers[name] = fn) } as never);
	const ctx = { hasUI: true, cwd: "/a/proj", ui: { setTitle: (t: string) => titles.push(t) }, sessionManager: { getSessionName: () => undefined } };
	return { handlers, titles, ctx };
}

test("tabTitle: icona, nome sessione e cartella", () => {
	assert.equal(tabTitle("X", "/a/proj"), "X π - proj");
	assert.equal(tabTitle("X", "/a/proj", "fix"), "X π - fix - proj");
});

test("fermo: pallino verde; al lavoro: spinner; a fine turno torna verde", () => {
	const { handlers, titles, ctx } = setup();
	handlers.session_start({}, ctx);
	handlers.agent_start({}, ctx);
	handlers.agent_end({}, ctx);
	assert.deepEqual(titles, [tabTitle(IDLE, "/a/proj"), tabTitle(FRAMES[0], "/a/proj"), tabTitle(IDLE, "/a/proj")]);
	handlers.session_shutdown({}, ctx);
});

test("PI_TAB_STATUS=0 non registra nulla", () => {
	process.env.PI_TAB_STATUS = "0";
	try { assert.deepEqual(setup().handlers, {}); } finally { delete process.env.PI_TAB_STATUS; }
});
