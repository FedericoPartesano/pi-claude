import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVault } from "../src/vault.ts";
import type { MemoryRecord } from "../src/store.ts";

const rec = (id: string, text: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-01", status: "active", entities: [], ...extra });

test("renderVault: one note per memory with frontmatter and [[links]], entity notes linking back (an Obsidian graph)", () => {
	const files = renderVault([rec("r1", "L'export usa ReportBuilder", { links: ["r2"], entities: ["builder.ts"] }), rec("r2", "La coda reports ha concorrenza 1", { type: "decisione", confirmations: 3 }), rec("r3", "Vecchio", { status: "superseded" })]);
	const r1 = files.get("ricordi/r1.md")!;
	assert.match(r1, /^---\ntipo: fatto\n/);
	assert.match(r1, /\[\[r2\]\]/);
	assert.match(r1, /\[\[builder\.ts\]\]/);
	assert.match(files.get("entita/builder.ts.md")!, /\[\[r1\]\]/);
	assert.ok(!files.has("ricordi/r3.md"), "superseded memories are left out");
	assert.match(files.get("indice.md")!, /\[\[r2\]\]/);
});

test("renderVault: entity names become safe file names", () => {
	const files = renderVault([rec("r1", "x", { entities: ["src/report/builder.ts", "a:b?c"] })]);
	assert.ok(files.has("entita/src∕report∕builder.ts.md"));
	assert.ok([...files.keys()].every((name) => !/[:?*"<>|]/.test(name)));
});
