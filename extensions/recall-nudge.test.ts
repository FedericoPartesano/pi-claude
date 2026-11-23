import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import recallNudge, { ABSTAIN, NUDGE_TYPE, needsNudge } from "./recall-nudge.ts";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const say = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", id: "t1", name, arguments: {} }] });
const result = () => ({ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "..." }] });
const nudge = () => ({ role: "custom", customType: NUDGE_TYPE, content: "x", display: false });

test("abstention phrases match, ordinary answers do not", () => {
	for (const s of ["Non lo so.", "7) non detto", "Il budget non è mai stato indicato", "non me l'hai mai detto", "Non risulta nel contesto", "Non ho questa informazione", "I don't know", "not provided"])
		assert.match(s, ABSTAIN, s);
	for (const s of ["La porta è 8443.", "Nessun errore nei test", "Fatto, il timeout vale 120000 ms."])
		assert.doesNotMatch(s, ABSTAIN, s);
});

test("nudges an abstention after a compress, only when nothing was searched", () => {
	assert.equal(needsNudge([user("q"), say("Non lo so")], true), true);
	assert.equal(needsNudge([user("q"), say("Non lo so")], false), false, "nothing folded: nothing to search");
	assert.equal(needsNudge([user("q"), say("La porta è 8443")], true), false);
	assert.equal(needsNudge([user("q"), call("search_context"), result(), say("Non lo so")], true), false);
	assert.equal(needsNudge([user("q"), call("decompress"), result(), say("Non lo so")], true), false);
});

test("at most one nudge per user prompt", () => {
	assert.equal(needsNudge([user("q"), say("Non lo so"), nudge(), say("Non lo so ancora")], true), false);
	assert.equal(needsNudge([user("q1"), say("Non lo so"), nudge(), say("no"), user("q2"), say("Non lo so")], true), true);
});

test("searches from an earlier prompt do not count", () => {
	assert.equal(needsNudge([user("q1"), call("search_context"), result(), say("ok"), user("q2"), say("Non lo so")], true), true);
});

function boundary(messages: unknown[], sessionFile: string | undefined, extra: Record<string, unknown> = {}) {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	recallNudge({ on: (name: string, h: never) => void (handlers[name] = h) } as never);
	const event = { type: "agent_before_settle", entries: [], continue: false, outcome: "completed", context: { contextMessages: messages, canContinue: false }, ...extra };
	return handlers.agent_before_settle(event, { sessionManager: { getSessionFile: () => sessionFile } });
}

function foldedSession(): string {
	const dir = mkdtempSync(join(tmpdir(), "recall-nudge-"));
	const file = join(dir, "s.jsonl");
	writeFileSync(`${file}.acp.json`, JSON.stringify({ blocks: [{ active: true, effectiveMessageIds: ["m1"] }] }));
	return file;
}

test("handler appends a hidden message and asks for one continuation", () => {
	const out = boundary([user("q"), say("Non lo so")], foldedSession()) as { entries: { type: string; customType: string; display: boolean; content: string }[]; continue: boolean };
	assert.equal(out.continue, true);
	assert.equal(out.entries.length, 1);
	assert.equal(out.entries[0].type, "custom_message");
	assert.equal(out.entries[0].customType, NUDGE_TYPE);
	assert.equal(out.entries[0].display, false);
	assert.match(out.entries[0].content, /search_context/);
});

test("handler stays quiet without folds or on abort, and ignores canContinue", () => {
	assert.equal(boundary([user("q"), say("Non lo so")], undefined), undefined);
	assert.equal(boundary([user("q"), say("Non lo so")], foldedSession(), { outcome: "aborted" }), undefined);
	// Pi reports canContinue false whenever the context ends with the answer: that must not stop the nudge.
	assert.notEqual(boundary([user("q"), say("Non lo so")], foldedSession(), { context: { contextMessages: [user("q"), say("Non lo so")], canContinue: false } }), undefined);
});
