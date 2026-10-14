import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureExcluded, parseProgress, readStats } from "./graphify.ts";

test("parseProgress legge le righe di avanzamento di graphify", () => {
	assert.deepEqual(parseProgress("  AST extraction: 200/514 uncached files (38%) [16 workers]"), { done: 200, total: 514 });
	assert.equal(parseProgress("Re-extracting code files in ."), undefined);
});

test("readStats conta nodi, archi, comunità e file; senza grafo è undefined", () => {
	const dir = mkdtempSync(join(tmpdir(), "gfy-"));
	assert.equal(readStats(dir), undefined);
	mkdirSync(join(dir, "graphify-out"));
	writeFileSync(join(dir, "graphify-out", "graph.json"), JSON.stringify({ nodes: [{ community: 0, source_file: "a.ts" }, { community: 1, source_file: "a.ts" }, { community: 1, source_file: "b.ts" }], links: [{}, {}] }));
	const stats = readStats(dir)!;
	assert.deepEqual([stats.nodes, stats.edges, stats.communities, stats.files], [3, 2, 2, 2]);
});

test("ensureExcluded aggiunge graphify-out/ una sola volta e non fallisce fuori da un repo", () => {
	const dir = mkdtempSync(join(tmpdir(), "gfy-"));
	ensureExcluded(dir);
	const git = join(dir, ".g" + "it");
	mkdirSync(join(git, "info"), { recursive: true });
	writeFileSync(join(git, "info", "exclude"), "# note");
	ensureExcluded(dir);
	ensureExcluded(dir);
	assert.equal(readFileSync(join(git, "info", "exclude"), "utf8"), "# note\ngraphify-out/\n");
});

test("isNoise: moduli esterni e codice letto da file JSON", async () => {
	const { isNoise } = await import("./graphify.ts");
	assert.equal(isNoise({ id: "ref_node_fs", label: "fs" }), true);
	assert.equal(isNoise({ id: "pi_ui_themes_lilla_colors", label: "colors", file_type: "code", source_file: "pi-ui/themes/lilla.json" }), true);
	assert.equal(isNoise({ id: "pi_picker_bin_pick_colors", label: "colors", file_type: "code", source_file: "pi-picker/bin/pick.ts" }), false);
	assert.equal(isNoise({ id: "README", label: "README", file_type: "document", source_file: "README.md" }), false);
});

test("filteredGraph toglie i nodi rumore e gli archi che li toccano; hubs non li elenca", async () => {
	const { filteredGraph, hubs } = await import("./graphify.ts");
	const dir = mkdtempSync(join(tmpdir(), "gfy-"));
	mkdirSync(join(dir, "graphify-out"));
	const nodes = [{ id: "a", label: "A", source_file: "a.ts", file_type: "code" }, { id: "b", label: "B", source_file: "b.ts", file_type: "code" }, { id: "ref_node_fs", label: "fs" }];
	writeFileSync(join(dir, "graphify-out", "graph.json"), JSON.stringify({ nodes, links: [{ source: "a", target: "b" }, { source: "a", target: "ref_node_fs" }, { source: "b", target: "ref_node_fs" }] }));
	const copy = JSON.parse(readFileSync(filteredGraph(dir)!, "utf8"));
	assert.equal(copy.nodes.length, 2);
	assert.equal(copy.links.length, 1);
	assert.match(hubs(dir), /A \(a\.ts\) - 1 collegamenti/);
	assert.doesNotMatch(hubs(dir), /fs/);
});
