import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { findImageRefs } from "../src/images.ts";
import { localRefs, previewColumns, renderPasteStrip } from "../src/paste-preview.ts";

const thumb = (cols: number, rows: number) => ({ lines: Array.from({ length: rows }, () => "▀".repeat(cols)), info: "", path: "x", width: 100, height: 100 });

test("paste paths from Windows, macOS and WSL are found", () => {
	const text = "vedi C:\\Users\\me\\AppData\\Local\\Temp\\pi-clipboard-1.png, /var/folders/ab/T/pi-clipboard-2.png e /tmp/pi-clipboard-3.png";
	assert.deepEqual(findImageRefs(text), ["C:\\Users\\me\\AppData\\Local\\Temp\\pi-clipboard-1.png", "/var/folders/ab/T/pi-clipboard-2.png", "/tmp/pi-clipboard-3.png"]);
	assert.deepEqual(localRefs(["a.png", "https://x.com/a.png"]), ["a.png"]);
});

test("previewColumns keeps the height within the rows and the strip within the room", () => {
	assert.equal(previewColumns(1000, 1000, 1, 100), 16);
	assert.equal(previewColumns(1000, 400, 1, 100), 24);
	assert.equal(previewColumns(100, 1000, 1, 100), 4);
	assert.ok(previewColumns(1000, 1000, 4, 60) * 4 + 2 + 6 <= 60);
});

test("renderPasteStrip puts the previews side by side and fits the width", () => {
	const lines = renderPasteStrip([thumb(10, 5), thumb(6, 3)], 2, 80);
	assert.equal(lines.length, 5);
	assert.ok(lines.every((line) => visibleWidth(line) <= 80));
	assert.ok(visibleWidth(lines[0]) >= 2 + 10 + 2 + 6);
	assert.deepEqual(renderPasteStrip([undefined, { error: "x" }], 2, 80), []);
	assert.match(renderPasteStrip([thumb(4, 2)], 6, 80)[0], /\+5/);
});
