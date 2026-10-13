import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProposal, buildDreamPrompt, cleanTopic, nearDuplicates, parseProposal, type MemoryEntry } from "./memory-core.ts";

const entry = (text: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({ type: "fatto", text, pinned: false, confirmations: 1, last: "2026-10-01", ...extra });

test("cleanTopic: one or two lowercase words, nothing else", () => {
	assert.equal(cleanTopic("Bug Server"), "bug server");
	assert.equal(cleanTopic("ricordi!"), "ricordi");
	assert.equal(cleanTopic("una frase troppo lunga qui"), undefined);
	assert.equal(cleanTopic("x"), undefined);
	assert.equal(cleanTopic(42), undefined);
});

test("parseProposal: topic on additions, topics for existing memories (max 40, known ids only)", () => {
	const topics = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i + 1}`, "ricordi"]));
	const parsed = parseProposal(JSON.stringify({ add: [{ type: "fatto", text: "il server sta su leopart", topic: "Bug Server" }], topics: { ...topics, m99: "fuori", x: "no" } }), 60);
	assert.ok(parsed.ok);
	if (!parsed.ok) return;
	assert.equal(parsed.proposal.add[0].topic, "bug server");
	assert.equal(Object.keys(parsed.proposal.topics ?? {}).length, 40);
	assert.equal(parsed.proposal.topics?.m99, undefined);
});

test("applyProposal: topics label memories without one, never overwrite", () => {
	const memory = [entry("uno", { topic: "vecchio" }), entry("due")];
	const result = applyProposal(memory, [], { add: [], reinforce: [], merge: [], update: [], forget: [], topics: { m1: "nuovo", m2: "ricordi" } }, "2026-10-13");
	assert.equal(result.memory[0].topic, "vecchio");
	assert.equal(result.memory[1].topic, "ricordi");
});

test("nearDuplicates and the deep prompt", () => {
	const memory = [entry("il server dei bug gira su leopart con docker"), entry("il server dei bug gira su leopart in docker"), entry("la voce usa alt+m per dettare")];
	assert.deepEqual(nearDuplicates(memory), [[0, 1]]);
	const deep = buildDreamPrompt(memory, "(nessuna)", "2026-10-13", { deep: true });
	assert.match(deep, /Possibili duplicati[^\n]*m1 ~ m2/);
	assert.match(deep, /"topics"/);
	assert.doesNotMatch(buildDreamPrompt(memory, "(nessuna)", "2026-10-13"), /Possibili duplicati/);
});
