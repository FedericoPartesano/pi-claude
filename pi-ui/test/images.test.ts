import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { findImageRefs, halfBlocks, thumbnailFor } from "../src/images.ts";

/** 8×4 RGBA image: left half red, right half blue. */
function pixels(width = 8, height = 4) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * width + x) * 4);
	return { width, height, data };
}

test("findImageRefs finds paths and URLs of images in prose, markdown and tool output", () => {
	const text = "Il grafico out/vendite.png è pronto, vedi anche ![logo](assets/logo.jpg) e https://example.com/a/b.webp?x=1.\nNon un'immagine: src/cart.js, image.png.bak";
	assert.deepEqual(findImageRefs(text), ["out/vendite.png", "assets/logo.jpg", "https://example.com/a/b.webp?x=1"]);
	assert.deepEqual(findImageRefs("niente qui"), []);
	assert.deepEqual(findImageRefs("`/tmp/shot 1.png` e /tmp/x.PNG"), ["/tmp/x.PNG"]);
});

test("halfBlocks: two pixels per cell, exact width, colors of each half", () => {
	const lines = halfBlocks(pixels(), 8);
	assert.equal(lines.length, 2);
	for (const line of lines) assert.equal(visibleWidth(line), 8);
	assert.match(lines[0], /38;2;255;0;0m\x1b\[48;2;255;0;0m▀/);
	assert.match(lines[0], /38;2;0;0;255m/);
	assert.equal(halfBlocks(pixels(100, 50), 20).length, 5, "keeps the aspect ratio");
});

test("thumbnailFor decodes PNG and JPEG files and reports size and format", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-img-"));
	const image = pixels(16, 8);
	const png = new PNG({ width: 16, height: 8 });
	png.data = Buffer.from(image.data);
	writeFileSync(join(dir, "a.png"), PNG.sync.write(png));
	writeFileSync(join(dir, "b.jpg"), jpeg.encode({ width: 16, height: 8, data: Buffer.from(image.data) }, 90).data);
	const fromPng = await thumbnailFor("a.png", dir, 16);
	assert.ok("lines" in fromPng, JSON.stringify(fromPng));
	assert.equal(fromPng.lines.length, 4);
	assert.match(fromPng.info, /16×8 · PNG · \d+ B/);
	const fromJpeg = await thumbnailFor(join(dir, "b.jpg"), "/", 16);
	assert.ok("lines" in fromJpeg);
	assert.match(fromJpeg.info, /JPEG/);
});

test("thumbnailFor never throws: missing, corrupt, unsupported or too large files give a reason", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-img-"));
	writeFileSync(join(dir, "bad.png"), "non è un png");
	writeFileSync(join(dir, "x.svg"), "<svg/>");
	assert.deepEqual(await thumbnailFor("missing.png", dir, 16), { error: "file non trovato" });
	assert.deepEqual(await thumbnailFor("bad.png", dir, 16), { error: "immagine non leggibile" });
	assert.deepEqual(await thumbnailFor("x.svg", dir, 16), { error: "anteprima non disponibile per SVG" });
	assert.deepEqual(await thumbnailFor("bad.png", dir, 16, { maxBytes: 3 }), { error: "troppo grande per l'anteprima" });
});
