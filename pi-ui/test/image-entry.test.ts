import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderImageEntry, thumbnailColumns } from "../src/image-entry.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const thumb = { lines: Array.from({ length: 6 }, () => "\x1b[38;2;1;2;3m\x1b[48;2;4;5;6m▀\x1b[0m".repeat(32)), info: "1280×640 · PNG · 84 KB", path: "/p/out/vendite.png" };

test("wide: thumbnail on the left, path, info and how to open on the right", () => {
	const lines = renderImageEntry("out/vendite.png", thumb, 120);
	assert.equal(lines.length, 6);
	assert.match(strip(lines[0]), /^\s+│\s?▀+\s+out\/vendite.png$/);
	assert.match(strip(lines[1]), /1280×640 · PNG · 84 KB/);
	assert.match(strip(lines[3]), /\/img apri/);
	for (const line of lines) assert.ok(visibleWidth(line) <= 120);
});

test("narrow: caption under the thumbnail; loading and errors are one line", () => {
	const narrow = renderImageEntry("out/vendite.png", { ...thumb, lines: thumb.lines.map((line) => line) }, 50).map(strip);
	assert.match(narrow[narrow.length - 1], /out\/vendite.png · 1280×640/);
	assert.match(strip(renderImageEntry("a.png", undefined, 80)[0]), /◆ Img\s+a.png\s+…/);
	assert.match(strip(renderImageEntry("a.png", { error: "file non trovato" }, 80)[0]), /◆ Img\s+a.png\s+file non trovato/);
});

test("thumbnailColumns adapts to the terminal", () => {
	assert.equal(thumbnailColumns(120), 32);
	assert.equal(thumbnailColumns(50), 42);
	assert.equal(thumbnailColumns(30), 22);
});
