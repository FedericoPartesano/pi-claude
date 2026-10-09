import { test } from "node:test";
import assert from "node:assert/strict";
import { clipboardImage, windowsClipboardImage, READ_IMAGE } from "../clipboard.mjs";

const png = "iVBORw0KGgo" + "A".repeat(200);

test("Windows clipboard (WSL): PowerShell's base64 PNG becomes an image; nothing or an error → no image", async () => {
	const fake = (out) => async (command, args) => {
		assert.ok(args.includes("-STA"));
		assert.equal(args[args.length - 1], READ_IMAGE);
		return out;
	};
	const self = process.execPath; // any existing file stands in for powershell.exe
	assert.deepEqual(await windowsClipboardImage(fake(`${png}\r\n`), self), { data: png, mimeType: "image/png" });
	assert.equal(await windowsClipboardImage(fake(""), self), undefined);
	assert.equal(await windowsClipboardImage(fake("Exception: something"), self), undefined);
	assert.equal(await windowsClipboardImage(async () => { throw new Error("timeout"); }, self), undefined);
	assert.equal(await windowsClipboardImage(fake(png), "/nope/powershell.exe"), undefined);
});

test("Electron's clipboard first, when it has an image", async () => {
	const electron = { readImage: () => ({ isEmpty: () => false, toPNG: () => Buffer.from("png-bytes") }) };
	assert.deepEqual(await clipboardImage(electron, true), { data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png" });
	const empty = { readImage: () => ({ isEmpty: () => true }) };
	assert.equal(await clipboardImage(empty, false), undefined);
});
