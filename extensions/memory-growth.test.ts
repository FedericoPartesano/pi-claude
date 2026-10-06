// Growth stress test (no model): a simulated year of use must keep every cost bounded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProposal, buildDreamPrompt, contextLine, enforceCap, fitBudget, lookbackBatch, parseProposal, type MemoryEntry, type Proposal } from "./memory-core.ts";

const CAP = 3600;
const LOOKBACK = 60_000;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
const chars = (entries: MemoryEntry[]) => entries.map(contextLine).join("\n").length;

test("enforceCap: memory.md never exceeds the cap; overflow goes to the archive, pinned and corrections first", () => {
	const memory: MemoryEntry[] = Array.from({ length: 120 }, (_, i) => ({ type: i % 10 === 0 ? "correzione" : "fatto", text: `ricordo numero ${i} con un po' di testo per occupare spazio`, pinned: i === 7, confirmations: i % 5, last: day(i), }));
	const { memory: kept, archive, moved } = enforceCap(memory, [], CAP, day(200));
	assert.ok(chars(kept) <= CAP, `${chars(kept)} > ${CAP}`);
	assert.ok(moved > 0);
	assert.equal(kept.length + archive.length, memory.length);
	assert.ok(kept.some((entry) => entry.pinned));
	assert.ok(kept.filter((entry) => entry.type === "correzione").length >= 10);
	assert.ok(archive.every((entry) => entry.reason === "oltre il tetto della memoria"));
});

test("a simulated year: 365 consolidations keep memory, context and the /dream prompt bounded", () => {
	let memory: MemoryEntry[] = [];
	let archive: MemoryEntry[] = [];
	let maxPrompt = 0;
	for (let d = 0; d < 365; d++) {
		const proposal: Proposal = {
			add: Array.from({ length: 1 + (d % 3) }, (_, k) => ({ type: k === 0 && d % 4 === 0 ? "correzione" : "fatto", text: `giorno ${d} regola ${k}: una cosa da ricordare scritta con parole normali` })),
			reinforce: memory.length > 3 ? [`m${1 + (d % Math.min(memory.length, 5))}`] : [],
			merge: [],
			update: [],
			forget: [],
		};
		({ memory, archive } = applyProposal(memory, archive, proposal, day(d)));
		({ memory, archive } = enforceCap(memory, archive, CAP, day(d)));
		maxPrompt = Math.max(maxPrompt, buildDreamPrompt(memory, "x".repeat(LOOKBACK), day(d)).length);
		assert.ok(chars(memory) <= CAP, `day ${d}: memory ${chars(memory)}`);
		assert.ok(chars(fitBudget(memory, CAP)) <= CAP);
	}
	// The prompt holds the capped memory + at most one lookback batch + fixed rules.
	assert.ok(maxPrompt <= LOOKBACK + CAP * 2 + 4000, `prompt ${maxPrompt}`);
	assert.ok(archive.length > 300, "the rest is archived, not lost");
	// Reinforced early memories survive the cap.
	assert.ok(memory.some((entry) => entry.confirmations > 10));
});

test("lookbackBatch: a big backlog is consolidated in batches, oldest first, with nothing skipped", () => {
	const dir = mkdtempSync(join(tmpdir(), "dream-batch-"));
	const files: string[] = [];
	for (let s = 0; s < 40; s++) {
		const path = join(dir, `s${String(s).padStart(2, "0")}.jsonl`);
		const at = new Date(Date.UTC(2026, 0, 1, 0, s)).toISOString();
		const lines = [JSON.stringify({ type: "session", cwd: "/p", timestamp: at })];
		for (let m = 0; m < 6; m++) lines.push(JSON.stringify({ type: "message", timestamp: new Date(Date.UTC(2026, 0, 1, 0, s, m)).toISOString(), message: { role: "user", content: [{ type: "text", text: `sessione ${s} messaggio ${m} ${"parole ".repeat(60)}` }] } }));
		writeFileSync(path, lines.join("\n"));
		utimesSync(path, new Date(at), new Date(at));
		files.push(path);
	}
	const seen = new Set<string>();
	let since = "";
	let batches = 0;
	for (;;) {
		const batch = lookbackBatch(files, { since, maxChars: 20_000 });
		if (!batch.text) break;
		batches++;
		assert.ok(batch.text.length <= 20_000);
		for (const match of batch.text.matchAll(/sessione (\d+) messaggio (\d+)/g)) seen.add(`${match[1]}/${match[2]}`);
		assert.ok(batch.until > since, "progress");
		since = batch.until;
		if (batch.pending === 0) break;
		assert.ok(batches < 50);
	}
	assert.ok(batches > 1, "the backlog did not fit in one batch");
	assert.equal(seen.size, 40 * 6, "every message consolidated exactly once across batches");
});

test("near-duplicates are not added twice: a fuller version supersedes, a shorter one reinforces (measured in the stress test)", () => {
	const memory: MemoryEntry[] = [
		{ type: "correzione", text: "Messaggi di commit in inglese", pinned: false, confirmations: 1, last: day(1) },
		{ type: "correzione", text: "Prezzi sempre in centesimi interi, mai float", pinned: false, confirmations: 3, last: day(1) },
	];
	const proposal: Proposal = {
		add: [
			{ type: "correzione", text: "Messaggi di commit in inglese, non italiano" },
			{ type: "correzione", text: "Prezzi in centesimi interi" },
			{ type: "fatto", text: "Il catalogo ha 200 libri" },
		],
		reinforce: [], merge: [], update: [], forget: [],
	};
	const { memory: after, archive } = applyProposal(memory, [], proposal, day(2));
	assert.deepEqual(after.map((entry) => [entry.text, entry.confirmations]), [
		["Messaggi di commit in inglese, non italiano", 2],
		["Prezzi sempre in centesimi interi, mai float", 4],
		["Il catalogo ha 200 libri", 1],
	]);
	assert.equal(archive.length, 1);
});

test("a contradiction is not mistaken for a duplicate: the old rule is superseded, not reinforced", () => {
	const memory: MemoryEntry[] = [{ type: "correzione", text: "Messaggi di commit in italiano", pinned: false, confirmations: 2, last: day(1) }];
	const proposal: Proposal = { add: [{ type: "correzione", text: "Messaggi di commit in inglese, non più in italiano" }], reinforce: [], merge: [], update: [], forget: [] };
	const { memory: after, archive } = applyProposal(memory, [], proposal, day(2));
	assert.deepEqual(after.map((entry) => entry.text), ["Messaggi di commit in inglese, non più in italiano"]);
	assert.match(archive[0].text, /in italiano$/);
});

test("metadata echoed by the model is stripped from memory text (measured: '… (c 1, ultima 2026-10-24)')", () => {
	const parsed = parseProposal('{"add":[{"type":"preferenza","text":"Lunghezza delle righe: variante 5-1-0 (c 1, ultima 2026-10-24)"},{"type":"fatto","text":"Catalogo (conferme 3, ultima 2026-10-01)"}]}', 0);
	assert.ok(parsed.ok);
	if (parsed.ok) assert.deepEqual(parsed.proposal.add.map((item) => item.text), ["Lunghezza delle righe: variante 5-1-0", "Catalogo"]);
});
