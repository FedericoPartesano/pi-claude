import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EpisodeSearch } from "../src/episodes.ts";

const session = (dir: string, name: string, started: string, messages: [string, string][]) => {
	const lines = [JSON.stringify({ type: "session", cwd: "/p", timestamp: started }), ...messages.map(([role, text], i) => JSON.stringify({ type: "message", timestamp: started.replace("00:00", `00:${String(i).padStart(2, "0")}`), message: { role, content: [{ type: "text", text }] } }))];
	writeFileSync(join(dir, name), lines.join("\n"));
	return join(dir, name);
};

test("episodes: the passage of a past session that answers, with its date, clipped", () => {
	const dir = mkdtempSync(join(tmpdir(), "ep-"));
	const a = session(dir, "a.jsonl", "2026-09-01T10:00:00Z", [["user", "ciao, sistemiamo il login"], ["assistant", "Ok, guardo AuthService"], ["user", "il token scade troppo presto"], ["assistant", "Ho portato la scadenza a 30 minuti in auth-policy.json"]]);
	const b = session(dir, "b.jsonl", "2026-09-20T10:00:00Z", [["user", "l'export excel va in OOM con file grandi"], ["assistant", "Il problema è che ReportBuilder carica tutte le righe"], ["user", "come lo risolviamo?"], ["assistant", "Passo a exceljs in streaming: la memoria resta costante"], ["user", "perfetto"]]);
	const search = new EpisodeSearch();
	const hits = search.search([a, b], "come avevamo risolto l'OOM dell'export excel?");
	assert.ok(hits.length >= 1);
	assert.equal(hits[0].date, "2026-09-20");
	assert.match(hits[0].text, /exceljs in streaming/);
	assert.ok(hits.every((hit) => hit.text.length <= 1500));
	assert.deepEqual(search.search([a, b], "ricetta della carbonara"), []);
});
