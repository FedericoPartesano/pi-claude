import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crashForm, crashId, markSeen, readCrashes, readSeen, splitCrashes, type CrashEntry } from "./crashes.ts";

const now = new Date("2026-10-13T12:00:00Z");
const at = (days: number, message = "boom") => ({ timestamp: new Date(now.getTime() - days * 86_400_000).toISOString(), message, version: "1.2.0" }) as CrashEntry;

test("splitCrashes: propone gli ultimi 7 giorni non ancora visti, il resto va solo segnato", () => {
	const recent = at(1, "recente");
	const old = at(20, "vecchio");
	const seen = at(2, "già visto");
	const { fresh, skip } = splitCrashes([recent, old, seen], new Set([crashId(seen)]), now);
	assert.deepEqual(fresh.map((c) => c.message), ["recente"]);
	assert.deepEqual(skip.map((c) => c.message), ["vecchio"]);
});

test("markSeen/readSeen: ricorda gli id e butta quelli dei crash spariti", () => {
	const home = mkdtempSync(join(tmpdir(), "crash-"));
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	const a = at(1, "a");
	writeFileSync(join(home, ".pi", "agent", "crashes.json"), JSON.stringify([a, { nope: true }]));
	assert.equal(readCrashes(home).length, 1);
	markSeen(home, [crashId(a), "id-di-un-crash-cancellato"]);
	assert.deepEqual([...readSeen(home)], [crashId(a)]);
	assert.deepEqual(readSeen(mkdtempSync(join(tmpdir(), "vuoto-"))).size, 0);
});

test("crashForm: titolo, versione e riga dello stack, gravità blocca, tipo crash", () => {
	const form = crashForm({ ...at(1, "This extension ctx is stale\nriga 2"), stack: "Error: x\n    at panelLines (index.ts:634:20)" }, true);
	assert.equal(form.kind, "crash");
	assert.equal(form.title, "Crash: This extension ctx is stale");
	assert.match(form.happened, /Pi 1\.2\.0 .*\n.*\n    ?at panelLines|at panelLines \(index\.ts:634:20\)/s);
	assert.equal(form.severity, "blocca");
	assert.equal(form.redact, true);
});
