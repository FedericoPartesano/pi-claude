import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeArgs, findChrome } from "./browser/chrome.ts";

test("finds the first installed Chrome; none → undefined", () => {
	assert.equal(findChrome((path) => path === "/usr/bin/chromium"), "/usr/bin/chromium");
	assert.equal(findChrome(() => false), undefined);
});

test("Chrome arguments: free debug port, own profile, app window or headless", () => {
	const window = chromeArgs({ profile: "/p", headless: false });
	assert.ok(window.includes("--remote-debugging-port=0"));
	assert.ok(window.includes("--user-data-dir=/p"));
	assert.ok(window.some((arg) => arg.startsWith("--app=")));
	assert.ok(!window.includes("--headless=new"));
	assert.ok(chromeArgs({ profile: "/p", headless: true }).includes("--headless=new"));
});
