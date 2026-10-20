import { test } from "node:test";
import assert from "node:assert/strict";
import { binaryOf } from "./browser/terminal-install.ts";
import { electronAsset, findTerminalBrowser, isWsl, parseBrowsers, shaFor } from "./browser/terminal-browser.ts";

const sample = JSON.stringify({
	self: null,
	browsers: [
		{ key: "1-1", cdpPort: 4000, inCurrentTab: false, tabs: [{ id: 1, active: true, targetId: "AAA" }] },
		{ key: "2-1", cdpPort: 5000, inCurrentTab: true, tabs: [{ id: 1, active: false, targetId: "B1" }, { id: 2, active: true, targetId: "B2" }] },
	],
});

test("attaches to the browser of this terminal tab, on its active tab", () => {
	assert.deepEqual(parseBrowsers(sample), { key: "2-1", endpoint: "http://127.0.0.1:5000", targetId: "B2" });
});

test("no current tab: the first browser; nothing running or bad output: undefined", () => {
	assert.equal(parseBrowsers(JSON.stringify({ browsers: [{ key: "9-1", cdpPort: 7, tabs: [] }] }))?.endpoint, "http://127.0.0.1:7");
	assert.equal(parseBrowsers(JSON.stringify({ self: null, browsers: [] })), undefined);
	assert.equal(parseBrowsers("no daemon"), undefined);
});

test("findTerminalBrowser: runner error, native Windows and PI_BROWSER_BACKEND=chrome give undefined", async () => {
	assert.equal((await findTerminalBrowser(async () => sample, "linux"))?.key, "2-1");
	assert.equal(await findTerminalBrowser(async () => { throw new Error("ENOENT"); }, "linux"), undefined);
	assert.equal(await findTerminalBrowser(async () => sample, "win32"), undefined);
	process.env.PI_BROWSER_BACKEND = "chrome";
	try {
		assert.equal(await findTerminalBrowser(async () => sample, "linux"), undefined);
	} finally {
		delete process.env.PI_BROWSER_BACKEND;
	}
});

test("WSL detection, Electron file per CPU and its checksum line", () => {
	assert.ok(isWsl("Linux version 6.18.33.2-microsoft-standard-WSL2"));
	assert.ok(!isWsl("Linux version 6.8.0-generic"));
	assert.equal(electronAsset("x64"), "electron-v40.10.6-linux-x64.zip");
	assert.equal(electronAsset("arm64"), "electron-v40.10.6-linux-arm64.zip");
	assert.equal(electronAsset("ia32"), undefined);
	const sha = "a".repeat(64);
	assert.equal(shaFor(`${"b".repeat(64)} *other.zip\n${sha} *electron-v40.10.6-linux-x64.zip\n`, "electron-v40.10.6-linux-x64.zip"), sha);
	assert.equal(shaFor("", "x.zip"), undefined);
});

test("the PATH command can be a wrapper: the real binary is the exec target", () => {
	assert.equal(binaryOf("/w/terminal-browser", '#!/bin/sh\nexec "/r/app/bin/terminal-browser" "$@"\n'), "/r/app/bin/terminal-browser");
	assert.equal(binaryOf("/w/terminal-browser", "\x7fELF"), "/w/terminal-browser");
});
