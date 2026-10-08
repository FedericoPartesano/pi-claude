import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderImageEntry, thumbnailColumns } from "../src/image-entry.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const thumb = { lines: Array.from({ length: 6 }, () => "\x1b[38;2;1;2;3m\x1b[48;2;4;5;6m▀\x1b[0m".repeat(32)), info: "1280×640 · PNG · 84 KB", path: "/p/out/vendite.png", width: 1280, height: 640 };

test("wide: thumbnail on the left, path, info and how to open on the right", () => {
	const lines = renderImageEntry("out/vendite.png", thumb, 120);
	assert.equal(lines.length, 6);
	assert.match(strip(lines[0]), /^\s+│\s?▀+\s+out\/vendite.png\s*$/);
	assert.match(strip(lines[1]), /1280×640 · PNG · 84 KB/);
	assert.match(strip(lines[3]), /\/img apri/);
	// Full width with plain spaces after the colors: Pi pads short lines under an overlay and would drop the final
	// reset, letting the thumbnail's background bleed up to the panel.
	for (const line of lines) assert.equal(visibleWidth(line), 120);
	for (const line of renderImageEntry("out/vendite.png", thumb, 50)) assert.equal(visibleWidth(line), 50);
});

test("narrow: caption under the thumbnail; loading and errors are one line", () => {
	const narrow = renderImageEntry("out/vendite.png", { ...thumb, lines: thumb.lines.map((line) => line) }, 50).map(strip);
	assert.match(narrow[narrow.length - 1], /out\/vendite.png · 1280×640/);
	assert.match(strip(renderImageEntry("a.png", undefined, 80)[0]), /◆ Img\s+a.png\s+…/);
	assert.match(strip(renderImageEntry("a.png", { error: "file non trovato" }, 80)[0]), /◆ Img\s+a.png\s+file non trovato/);
});

test("thumbnailColumns adapts to the terminal", () => {
	assert.equal(thumbnailColumns(120), 64);
	assert.equal(thumbnailColumns(50), 42);
	assert.equal(thumbnailColumns(30), 22);
});

import { setCapabilities } from "@earendil-works/pi-tui";

test("on terminals with real images (kitty protocol: WezTerm, kitty, Ghostty) the entry shows the image itself", () => {
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
	try {
		const lines = renderImageEntry("shot.png", { ...thumb, png, width: 1, height: 1 }, 120);
		assert.ok(lines.some((line) => line.includes("\x1b_G")), "kitty graphics sequence");
		assert.match(strip(lines[0]), /shot\.png · 1280×640 · PNG · 84 KB · \/img apri/);
	} finally {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	}
});

test("with the side panel open a real image cannot be drawn (Pi draws images only in full-width boxes): a clear line instead of empty space", async () => {
	const { setCapabilityOverrides } = await import("@earendil-works/pi-tui");
	const { renderImageEntry } = await import("../src/image-entry.ts");
	setCapabilityOverrides({ images: "kitty" });
	const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
	const thumb = { lines: ["▀▀"], info: "1600×1000 · PNG · 86 KB", png, width: 1600, height: 1000, path: "/tmp/a.png" };
	const hidden = renderImageEntry("/tmp/a.png", thumb as never, 100, { sidebarOpen: true }).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
	assert.equal(hidden.length, 2);
	assert.match(hidden[1], /immagine nascosta mentre il pannello è aperto · Alt\+S per vederla · \/img per aprirla/);
	setCapabilityOverrides({});
});

test("while a thumbnail is being prepared: an animated loading line, at the exact width, moving frame to frame", async () => {
	const { renderImageLoading } = await import("../src/image-entry.ts");
	const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
	const a = renderImageLoading("shots/a.png", 80, 0);
	const b = renderImageLoading("shots/a.png", 80, 3);
	assert.equal(a.length, 1);
	assert.equal(visibleWidth(a[0]), 80);
	assert.match(strip(a[0]), /shots\/a\.png/);
	assert.match(strip(a[0]), /preparo l'anteprima/);
	assert.match(strip(a[0]), /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
	assert.notEqual(a[0], b[0], "it moves");
	assert.equal(visibleWidth(renderImageLoading("x".repeat(200), 40, 1)[0]), 40);
});
