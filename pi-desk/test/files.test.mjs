import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kindOf, parseDelimited, readForPanel, resolvePath } from "../files.mjs";

test("kinds and paths: relative to the project, ~ to the home", () => {
	assert.equal(kindOf("a/report.PDF"), "pdf");
	assert.equal(kindOf("x.csv"), "csv");
	assert.equal(kindOf("src/app.tsx"), "text");
	assert.equal(kindOf("Dockerfile"), "text");
	assert.equal(kindOf("archive.zip"), undefined);
	assert.equal(resolvePath("docs/a.md", "/p/shop"), "/p/shop/docs/a.md");
	assert.equal(resolvePath("/abs/a.md", "/p/shop"), "/abs/a.md");
	assert.match(resolvePath("~/x.png", "/p"), /\/x\.png$/);
});

test("read for the panel: text kinds as text, pdf and images as file URLs, errors in words", () => {
	const dir = mkdtempSync(join(tmpdir(), "files-"));
	mkdirSync(join(dir, "docs"));
	writeFileSync(join(dir, "docs/a.md"), "# Titolo");
	writeFileSync(join(dir, "r.pdf"), "%PDF-1.4");
	const md = readForPanel("docs/a.md", dir);
	assert.equal(md.kind, "markdown");
	assert.equal(md.text, "# Titolo");
	const pdf = readForPanel("r.pdf", dir);
	assert.equal(pdf.kind, "pdf");
	assert.match(pdf.url, /^file:\/\/.*r\.pdf$/);
	assert.match(readForPanel("nope.md", dir).error, /non trovato/);
	writeFileSync(join(dir, "z.zip"), "x");
	assert.match(readForPanel("z.zip", dir).error, /non visualizzabile/);
});

test("CSV: quotes, escaped quotes, newlines and separators inside quotes", () => {
	assert.deepEqual(parseDelimited('nome,note\n"Rossi, Mario","dice ""ciao""\nsu due righe"\nBianchi,ok\n'), [["nome", "note"], ["Rossi, Mario", 'dice "ciao"\nsu due righe'], ["Bianchi", "ok"]]);
	assert.deepEqual(parseDelimited("a\tb\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
});
