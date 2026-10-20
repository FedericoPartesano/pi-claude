import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFakeEmbedder } from "../../pi-memory/src/embed.ts";
import { MAX_CHARS, chunkMarkdown, frontmatter } from "./chunk.ts";
import { VaultIndex } from "./index.ts";
import { loaderScreen } from "./loader.ts";
import { findVault, ignoreMatcher, readSources, vaultFiles } from "./scan.ts";

const NOTE = `---
tags: [dev, "#idea"]
---
Intro con [[Altra nota]] e #tag-inline.

# Progetto
Testo del progetto.

## Decisioni
- usare sqlite

\`\`\`ts
# non è un titolo
const x = 1;

const y = 2;
\`\`\`

### Dettagli
Sotto-dettaglio con [[Link|alias]].
`;

test("frontmatter: tag inline e righe occupate", () => {
	assert.deepEqual(frontmatter(NOTE), { tags: ["dev", "idea"], lines: 3 });
	assert.deepEqual(frontmatter("senza\nfrontmatter"), { tags: [], lines: 0 });
	assert.deepEqual(frontmatter("---\ntags:\n  - a\n  - b\n---\nx").tags, ["a", "b"]);
});

test("chunk: titoli con percorso, righe, tag, wikilink, codice intero", () => {
	const chunks = chunkMarkdown("n.md", NOTE);
	assert.deepEqual(chunks.map((chunk) => chunk.section), ["", "Progetto", "Progetto › Decisioni", "Progetto › Decisioni › Dettagli"]);
	assert.equal(chunks[0].line, 4);
	assert.deepEqual(chunks[0].links, ["Altra nota"]);
	assert.ok(chunks[0].tags.includes("dev") && chunks[0].tags.includes("tag-inline"));
	assert.deepEqual(chunks[3].links, ["Link"]);
	const code = chunks[2];
	assert.ok(code.text.includes("# non è un titolo") && code.text.includes("const y = 2;"), "il blocco di codice resta intero e il # dentro non è un titolo");
	assert.ok(code.text.startsWith("n.md › Progetto › Decisioni\n"));
});

test("chunk: sezione lunga spezzata ai paragrafi entro il limite", () => {
	const paragraph = "parola ".repeat(40).trim();
	const chunks = chunkMarkdown("l.md", `# T\n${Array(10).fill(paragraph).join("\n\n")}`);
	assert.ok(chunks.length > 1);
	for (const chunk of chunks) assert.ok(chunk.text.length <= MAX_CHARS + 20 + paragraph.length);
	assert.equal(chunks.map((chunk) => chunk.text.split(paragraph).length - 1).reduce((a, b) => a + b, 0), 10);
});

test("chunk: sezioni vuote saltate", () => {
	assert.deepEqual(chunkMarkdown("v.md", "# Solo titolo\n\n## Altro\ncorpo").map((chunk) => chunk.section), ["Solo titolo › Altro"]);
});

const embedder = createFakeEmbedder();
const files = (extra: Record<string, string> = {}) => Object.entries({ "a.md": "# Cane\nIl cane abbaia forte.\n\n# Gatto\nIl gatto miagola piano.", "b.md": "# Auto\nLa macchina ha un motore diesel.", ...extra }).map(([path, source]) => ({ path, source }));

test("update: solo i chunk nuovi o modificati vengono embeddati, i cancellati spariscono", async () => {
	const index = new VaultIndex();
	assert.deepEqual(await index.update(files(), embedder), { files: 2, chunks: 3, embedded: 3, reused: 0, removed: 0 });
	assert.deepEqual(await index.update(files(), embedder), { files: 2, chunks: 3, embedded: 0, reused: 3, removed: 0 });
	const changed = files({ "b.md": "# Auto\nLa macchina ha un motore elettrico." });
	assert.deepEqual(await index.update(changed, embedder), { files: 2, chunks: 3, embedded: 1, reused: 2, removed: 1 });
	const shorter = [{ path: "a.md", source: "# Cane\nIl cane abbaia forte." }];
	const stats = await index.update(shorter, embedder);
	assert.equal(stats.removed, 2);
	assert.equal(index.size, 1, "nessun chunk orfano");
	assert.deepEqual(index.paths, ["a.md"]);
});

test("plan: stima senza modello; cambio modello = tutto da rifare", async () => {
	const index = new VaultIndex();
	assert.equal(index.plan(files(), "fake").pending, 3);
	await index.update(files(), embedder);
	assert.deepEqual(index.plan(files(), "fake"), { chunks: 3, pending: 0, removed: 0 });
	assert.equal(index.plan(files(), "altro-modello").pending, 3);
	const other = { ...embedder, model: "altro-modello", embed: embedder.embed };
	assert.equal((await index.update(files(), other)).embedded, 3);
	assert.equal(index.model, "altro-modello");
});

test("JSON: round trip, versione diversa = indice vuoto", async () => {
	const index = new VaultIndex();
	await index.update(files(), embedder);
	const back = VaultIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())));
	assert.equal(back.size, 3);
	assert.equal(back.model, "fake");
	assert.equal(VaultIndex.fromJSON({ version: 99, entries: index.toJSON().entries }).size, 0);
});

test("search: vettori e ibrido trovano la nota giusta; soglia scarta il non pertinente; indice di altro modello rifiutato", async () => {
	const index = new VaultIndex();
	await index.update(files(), embedder);
	const vector = await index.search("gatto miagola", embedder, 3, "vector");
	assert.equal(vector[0].section, "Gatto");
	const hybrid = await index.search("motore diesel", embedder, 3, "hybrid");
	assert.equal(hybrid[0].path, "b.md");
	assert.deepEqual(await index.search("zzzz qqqq", embedder, 3, "hybrid"), []);
	await assert.rejects(index.search("x", { ...embedder, model: "x", embed: embedder.embed }, 3), /altro modello/);
});

test("ibrido: il token esatto che i vettori non vedono viene trovato da BM25", async () => {
	const strict = { ...embedder, semFloor: 0.99, embed: embedder.embed };
	const index = new VaultIndex();
	await index.update(files({ "c.md": "# Ticket\nVedi ABC-4711 per i dettagli." }), strict);
	assert.deepEqual(await index.search("ABC-4711", strict, 3, "vector"), []);
	assert.equal((await index.search("ABC-4711", strict, 3, "hybrid"))[0].path, "c.md");
});

test("scan: vault da PI_VAULT o .obsidian, ignorati nascosti/.vaultignore/non md, CLAUDE.md senza duplicati", () => {
	const root = mkdtempSync(join(tmpdir(), "vault-"));
	mkdirSync(join(root, ".obsidian"));
	mkdirSync(join(root, "note", "privato"), { recursive: true });
	mkdirSync(join(root, ".nascosta"));
	for (const [path, text] of Object.entries({ "uno.md": "# Uno\nx", "note/due.md": "# Due\ny", "note/privato/segreto.md": "# S\nz", ".nascosta/h.md": "# H\nk", "img.png": "x", ".vaultignore": "privato/\n*.tmp.md\n", "bozza.tmp.md": "# B\nq", "CLAUDE.md": "# Regole\nuse tabs" })) writeFileSync(join(root, path), text);
	assert.equal(findVault(join(root, "note"), {}), root);
	const repo = mkdtempSync(join(tmpdir(), "repo-"));
	mkdirSync(join(repo, "vault", ".obsidian"), { recursive: true });
	mkdirSync(join(repo, "node_modules", "x", ".obsidian"), { recursive: true });
	assert.equal(findVault(repo, {}), join(repo, "vault"), "vault in una sottocartella del cwd");
	assert.equal(findVault(mkdtempSync(join(tmpdir(), "vuota-")), {}), undefined);
	assert.equal(findVault("/tmp", { PI_VAULT: "/non/esiste" }), undefined);
	assert.deepEqual(vaultFiles(root).map((item) => item.path).sort(), ["CLAUDE.md", "note/due.md", "uno.md"]);
	assert.deepEqual(readSources(root, root, "/non/esiste").map((item) => item.path).sort(), ["CLAUDE.md", "note/due.md", "uno.md"]);
	assert.equal(ignoreMatcher("a/b.md")("a/b.md"), true);
	assert.equal(ignoreMatcher("# c\nx")("y/z.md"), false);
});

test("ricerca: titolo, filtri per tag e cartella, collegamenti", async () => {
	const embedder = createFakeEmbedder();
	const index = new VaultIndex();
	await index.update([
		{ path: "01/ADR-007-baseline.md", source: "---\ntags: [decisione]\n---\n# Baseline\nScelta della sorgente dati. Vedi [[Docker]]." },
		{ path: "02/Docker.md", source: "# Docker\nImmagini e variabili.\n#infra" },
		{ path: "02/Altro.md", source: "# Altro\nTesto qualunque sul [[Docker]]." },
	], embedder);
	const names = async (query: string, filter = {}) => (await index.search(query, embedder, 5, "hybrid", filter)).map((hit) => hit.path);
	assert.equal((await names("adr 007"))[0], "01/ADR-007-baseline.md", "il nome del file basta");
	assert.deepEqual((await names("Docker", { folder: "02" })).filter((path) => !path.startsWith("02/")), []);
	assert.deepEqual((await names("Docker", { tag: "#decisione" })).filter((path) => path !== "01/ADR-007-baseline.md"), []);
	const rel = index.relations("02/Docker.md");
	assert.deepEqual(rel.backlinks.sort(), ["01/ADR-007-baseline.md", "02/Altro.md"]);
	assert.deepEqual(index.relations("01/ADR-007-baseline.md").links, ["Docker"]);
});

test("loader a schermo intero: altezza e larghezza esatte, avanzamento, feed", () => {
	const base = { step: "vettori" as const, files: 70, done: 620, total: 1240, filesDone: 30, filesTotal: 70, current: "docs/a.md › Titolo", startedAt: 0, now: 60_000, feed: ["x.md", "y.md"], rates: [3, 5, 6, 4] };
	for (const [w, h] of [[120, 40], [80, 24], [40, 12]]) {
		const lines = loaderScreen(base, w, h);
		assert.equal(lines.length, h);
		for (const line of lines) assert.equal(line.replace(/\x1b\[[0-9;]*m/g, "").length, w);
	}
	const text = loaderScreen(base, 120, 40).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
	assert.match(text, /50%/);
	assert.match(text, /620 di 1\.2k|620 di 1,2k|620 di 1\.2k sezioni/);
	assert.match(text, /docs\/a\.md › Titolo/);
	assert.match(text, /✓ y\.md/);
	assert.match(text, /Esc annulla/);
});
