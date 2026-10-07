/**
 * Image thumbnails that work in every truecolor terminal (tmux and WSL included): each cell is "▀" with the upper
 * pixel as foreground and the lower one as background. PNG and JPEG are decoded in pure JavaScript.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const EXTENSIONS = "png|jpe?g|gif|webp|svg|bmp";
const URL_PATTERN = new RegExp(`https?://[^\\s)"'<>\`]+?\\.(?:${EXTENSIONS})(?:\\?[^\\s)"'<>\`]*)?(?=$|[\\s)"'<>\`]|[.,;:!?](?:\\s|$))`, "gi");
const PATH_PATTERN = new RegExp(`(?:^|[\\s(\\[\`'"])((?:~|\\.{1,2})?/?(?:[\\w@.-]+/)*[\\w@-][\\w@.-]*\\.(?:${EXTENSIONS}))(?=$|[\\s)\\]\`'"]|[.,;:!?](?:\\s|$))`, "gim");

export const CACHE_DIR = join(homedir(), ".cache/pi-ui");
export const MAX_BYTES = 10 * 1024 * 1024;

/** Paths and URLs of images, in order of appearance, without duplicates. */
export function findImageRefs(text: string): string[] {
	// Code spans with spaces hold paths that cannot be opened as they are ("`shot 1.png`").
	const clean = text.replace(/`[^`\n]*\s[^`\n]*`/g, " ");
	const refs: { at: number; ref: string }[] = [];
	// A sentence's final punctuation is not part of the URL.
	for (const match of clean.matchAll(URL_PATTERN)) refs.push({ at: match.index ?? 0, ref: match[0].replace(/[.,;:!?]+$/, "") });
	const withoutUrls = clean.replace(URL_PATTERN, (url) => " ".repeat(url.length));
	for (const match of withoutUrls.matchAll(PATH_PATTERN)) refs.push({ at: (match.index ?? 0) + match[0].indexOf(match[1]), ref: match[1] });
	return [...new Set(refs.sort((a, b) => a.at - b.at).map((entry) => entry.ref))];
}

export interface Pixels {
	width: number;
	height: number;
	/** RGBA, 4 bytes per pixel. */
	data: Uint8Array;
}

const BACKGROUND = [12, 12, 12];

/** Thumbnail `cols` cells wide; rows keep the aspect ratio (a cell is two pixels tall). */
export function halfBlocks(image: Pixels, cols: number): string[] {
	const rows = Math.max(1, Math.round((cols * image.height) / image.width / 2));
	// Each half cell is the average of the source area it covers (box filter): no jagged nearest-pixel aliasing.
	const sample = (cx: number, cy: number) => {
		const x0 = Math.floor((cx * image.width) / cols);
		const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * image.width) / cols));
		const y0 = Math.floor((cy * image.height) / (rows * 2));
		const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * image.height) / (rows * 2)));
		const sum = [0, 0, 0];
		let count = 0;
		for (let y = y0; y < Math.min(y1, image.height); y++) {
			for (let x = x0; x < Math.min(x1, image.width); x++) {
				const offset = (y * image.width + x) * 4;
				const alpha = image.data[offset + 3] / 255;
				for (let channel = 0; channel < 3; channel++) sum[channel] += image.data[offset + channel] * alpha + BACKGROUND[channel] * (1 - alpha);
				count++;
			}
		}
		return sum.map((value) => Math.round(value / Math.max(1, count))).join(";");
	};
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = "";
		for (let col = 0; col < cols; col++) line += `\x1b[38;2;${sample(col, row * 2)}m\x1b[48;2;${sample(col, row * 2 + 1)}m▀`;
		lines.push(`${line}\x1b[0m`);
	}
	return lines;
}

const formatBytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Downloads an image URL into the cache (once) and returns the local path. */
async function download(url: string, cacheDir: string, maxBytes: number): Promise<string | { error: string }> {
	const extension = /\.(\w+)(?:\?|$)/.exec(url)?.[1] ?? "img";
	const file = join(cacheDir, `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.${extension}`);
	if (existsSync(file)) return file;
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		if (!response.ok) return { error: `download non riuscito (${response.status})` };
		const body = Buffer.from(await response.arrayBuffer());
		if (body.length > maxBytes) return { error: "troppo grande per l'anteprima" };
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(file, body);
		return file;
	} catch {
		return { error: "download non riuscito" };
	}
}

/** Half-block lines, caption info, local path, and the image as PNG base64 for terminals that show real images. */
export type Thumbnail = { lines: string[]; info: string; path: string; png?: string; width: number; height: number } | { error: string };

/** Thumbnail of a local path (relative to cwd) or URL. Never throws: failures come back as a reason. */
export async function thumbnailFor(ref: string, cwd: string, cols: number, options: { maxBytes?: number; cacheDir?: string } = {}): Promise<Thumbnail> {
	const maxBytes = options.maxBytes ?? MAX_BYTES;
	let path: string;
	if (/^https?:\/\//i.test(ref)) {
		const downloaded = await download(ref, options.cacheDir ?? CACHE_DIR, maxBytes);
		if (typeof downloaded !== "string") return downloaded;
		path = downloaded;
	} else {
		path = ref.startsWith("~/") ? join(homedir(), ref.slice(2)) : isAbsolute(ref) ? ref : resolve(cwd, ref);
	}
	if (!existsSync(path)) return { error: "file non trovato" };
	const size = statSync(path).size;
	if (size > maxBytes) return { error: "troppo grande per l'anteprima" };
	const format = (/\.(\w+)(?:\?.*)?$/.exec(path)?.[1] ?? "").toLowerCase().replace("jpg", "jpeg");
	if (format !== "png" && format !== "jpeg") return { error: `anteprima non disponibile per ${format.toUpperCase()}` };
	try {
		const buffer = readFileSync(path);
		// Refuse huge canvases before decoding (a small PNG can expand to gigabytes).
		if (format === "png" && buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > 40_000_000) return { error: "troppo grande per l'anteprima" };
		const image: Pixels = format === "png" ? PNG.sync.read(buffer) : jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40 });
		// Kitty-protocol terminals accept PNG only: a JPEG is re-encoded once here.
		let png = buffer.toString("base64");
		if (format === "jpeg") {
			const encoded = new PNG({ width: image.width, height: image.height });
			encoded.data = Buffer.from(image.data);
			png = PNG.sync.write(encoded).toString("base64");
		}
		return { lines: halfBlocks(image, cols), info: `${image.width}×${image.height} · ${format.toUpperCase()} · ${formatBytes(size)}`, path, png, width: image.width, height: image.height };
	} catch {
		return { error: "immagine non leggibile" };
	}
}
