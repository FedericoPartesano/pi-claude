import { test } from "node:test";
import assert from "node:assert/strict";
import { isSmallTalk, recallMessage } from "../src/recall.ts";

test("small talk recalls nothing: 'procedi' once got the memories answered instead of being done", () => {
	for (const prompt of ["procedi", "ok", "vai", "ciao", "ok grazie", "sì procedi", "asd", "continua", "  Procedi! "]) assert.equal(isSmallTalk(prompt), true, prompt);
	for (const prompt of ["intents?", "procedi con il merge di origin/dev", "come gestiamo le date?", "fix login"]) assert.equal(isSmallTalk(prompt), false, prompt);
});

test("the recall message ends with the user's own request, so the model's last word is the request, not the memories", () => {
	const message = recallMessage("Ricordi pertinenti:\n- [fatto] x", "procedi con il merge");
	assert.ok(message.startsWith("Ricordi pertinenti:\n- [fatto] x"));
	assert.match(message.split("\n").at(-1)!, /^Il messaggio dell'utente a cui rispondere è: «procedi con il merge»/);
	assert.ok(recallMessage("R", "x".repeat(2000)).length < 700, "long requests are clipped");
});
