/**
 * Files for the document panel: what a path points at (relative paths are the project's, ~ the home) and how to show
 * it. Text kinds come back as text (capped); PDFs and images as file:// URLs (Chromium shows them).
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_MAX = 2 * 1024 * 1024;
const KINDS = {
	pdf: "pdf",
	png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image", avif: "image",
	md: "markdown", markdown: "markdown",
	csv: "csv", tsv: "tsv",
	json: "json", jsonl: "text",
	html: "html", htm: "html",
};
const TEXT_EXT = new Set("txt log ts tsx js mjs cjs jsx py rb go rs java kt cs c h cpp hpp css scss sql sh bash zsh yml yaml toml ini env xml vue svelte php swift dart lua r gradle properties conf dockerfile makefile".split(" "));

export function kindOf(path) {
	const ext = extname(path).slice(1).toLowerCase();
	if (KINDS[ext]) return KINDS[ext];
	if (TEXT_EXT.has(ext) || /(^|\/)(dockerfile|makefile|readme|license)$/i.test(path)) return "text";
	return undefined;
}

export function resolvePath(path, project) {
	const clean = String(path).replace(/^file:\/\//, "");
	if (clean.startsWith("~/")) return join(homedir(), clean.slice(2));
	return isAbsolute(clean) ? clean : resolve(project, clean);
}

/** { path, name, kind, size, text? , url? } or { error } */
export function readForPanel(path, project) {
	const full = resolvePath(path, project);
	let stat;
	try {
		stat = statSync(full);
	} catch {
		return { error: `File non trovato: ${full}` };
	}
	if (!stat.isFile()) return { error: `Non è un file: ${full}` };
	const kind = kindOf(full);
	const base = { path: full, name: full.split(/[\\/]/).pop(), kind: kind ?? "unknown", size: stat.size };
	if (!kind) return { ...base, error: "Formato non visualizzabile qui" };
	if (kind === "pdf" || kind === "image" || kind === "html") return { ...base, url: pathToFileURL(full).href };
	const buffer = readFileSync(full);
	const text = buffer.subarray(0, TEXT_MAX).toString("utf8");
	const truncated = buffer.length > TEXT_MAX;
	if (kind === "csv" || kind === "tsv") {
		const rows = parseDelimited(text, kind === "tsv" ? "\t" : text.split("\n", 1)[0].includes(";") && !text.split("\n", 1)[0].includes(",") ? ";" : ",");
		return { ...base, rows: rows.slice(0, 5001), truncated: truncated || rows.length > 5001 };
	}
	return { ...base, text, truncated };
}

/** CSV/TSV rows (quotes, escaped quotes, newlines inside quotes). */
export function parseDelimited(text, separator = ",") {
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') (cell += '"'), i++;
			else if (char === '"') quoted = false;
			else cell += char;
		} else if (char === '"' && cell === "") quoted = true;
		else if (char === separator) row.push(cell), (cell = "");
		else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += char;
	}
	if (cell !== "" || row.length) row.push(cell), rows.push(row);
	return rows.filter((cells) => cells.length > 1 || cells[0] !== "");
}
