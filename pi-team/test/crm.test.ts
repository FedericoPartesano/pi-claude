import assert from "node:assert/strict";
import { test } from "node:test";
import { CALLOUT_INSTRUCTIONS, isHalting, parseCallout, withCallout } from "../src/crm.ts";

test("parseCallout: reads the last STATO line, any keyword", () => {
	assert.deepEqual(parseCallout("x\n## Risultati\nok\nSTATO: FATTO"), { kind: "done", detail: "" });
	assert.deepEqual(parseCallout("STATO: BLOCCATO — manca il file a.ts"), { kind: "blocked", detail: "manca il file a.ts" });
	assert.deepEqual(parseCallout("STATO: DISACCORDO: la funzione esiste già in b.ts"), { kind: "disagree", detail: "la funzione esiste già in b.ts" });
	assert.equal(parseCallout("STATO: FATTO\naltro\nSTATO: DEVIAZIONE - ho toccato c.ts")?.kind, "deviation");
});

test("parseCallout: no callout or unknown keyword means legacy free text", () => {
	assert.equal(parseCallout("## Risultati\nfatto"), undefined);
	assert.equal(parseCallout("STATO: OK"), undefined);
	assert.equal(parseCallout("il campo STATO: FATTO è citato a metà riga"), undefined);
});

test("isHalting: only blocked and disagree stop the retries", () => {
	assert.equal(isHalting(parseCallout("STATO: BLOCCATO — x")), true);
	assert.equal(isHalting(parseCallout("STATO: DISACCORDO — x")), true);
	assert.equal(isHalting(parseCallout("STATO: DEVIAZIONE — x")), false);
	assert.equal(isHalting(undefined), false);
});

test("withCallout: a deviation is prefixed to the summary, other kinds leave it alone", () => {
	assert.equal(withCallout("ok", parseCallout("STATO: DEVIAZIONE — toccato c.ts")), "⚠ Deviazione: toccato c.ts\nok");
	assert.equal(withCallout("ok", parseCallout("STATO: FATTO")), "ok");
});

test("instructions: every keyword the parser reads is announced to the agent", () => {
	for (const word of ["FATTO", "DEVIAZIONE", "BLOCCATO", "DISACCORDO"]) assert.match(CALLOUT_INSTRUCTIONS, new RegExp(word));
});

test("crmEnabled: only PI_TEAM_CRM=0 turns the protocol off", async () => {
	const { crmEnabled } = await import("../src/crm.ts");
	assert.equal(crmEnabled({}), true);
	assert.equal(crmEnabled({ PI_TEAM_CRM: "1" }), true);
	assert.equal(crmEnabled({ PI_TEAM_CRM: "0" }), false);
});

test("stripCallout: drops the STATO line and the old header, caps the length", async () => {
	const { stripCallout, CALLOUT_SUMMARY_CHARS } = await import("../src/crm.ts");
	assert.equal(stripCallout("a.ts: fix\nSTATO: FATTO"), "a.ts: fix");
	assert.equal(stripCallout("prosa\n## Risultati\nb.ts: x\nSTATO: FATTO"), "b.ts: x");
	assert.ok(stripCallout("x".repeat(5000) + "\nSTATO: FATTO").length <= CALLOUT_SUMMARY_CHARS);
});

test("instructions: under 760 characters", () => {
	assert.ok(CALLOUT_INSTRUCTIONS.length < 760, String(CALLOUT_INSTRUCTIONS.length));
});

test("reviewMaterial: status, diff and new files of a real repo; empty outside git or when clean", async () => {
	const { reviewMaterial } = await import("../src/crm.ts");
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { execSync } = await import("node:child_process");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "crm-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name n && echo uno > a.txt && git add . && git commit -qm i", { cwd: dir });
	assert.equal(await reviewMaterial(dir), "");
	writeFileSync(join(dir, "a.txt"), "due\n");
	writeFileSync(join(dir, "b.txt"), "nuovo\n");
	const block = await reviewMaterial(dir);
	assert.match(block, /\+due/);
	assert.match(block, /### nuovo: b\.txt\nnuovo/);
	assert.equal(await reviewMaterial(mkdtempSync(join(tmpdir(), "nogit-"))), "");
});

test("taskBriefing: existing files only, no escape from cwd, empty over the cap", async () => {
	const { taskBriefing } = await import("../src/crm.ts");
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "brief-"));
	writeFileSync(join(dir, "a.js"), "uno");
	const text = await taskBriefing(dir, ["a.js", "manca.js", "../etc/passwd", "src/"]);
	assert.match(text, /### a\.js\nuno/);
	assert.doesNotMatch(text, /manca|passwd/);
	assert.equal(await taskBriefing(dir, undefined), "");
	writeFileSync(join(dir, "big.js"), "x".repeat(10000));
	assert.equal(await taskBriefing(dir, ["a.js", "big.js"]), "");
});
