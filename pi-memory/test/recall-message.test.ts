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

test("linked memories only follow a strong direct hit", async () => {
	const { RecallIndex, recall } = await import("../src/recall.ts");
	const rec = (id: string, text: string, links: string[] = []) => ({ id, type: "fatto", text, pinned: false, confirmations: 1, created: "2026-10-01", last: "2026-10-06", status: "active" as const, entities: [], links });
	const index = new RecallIndex([rec("a", "Il deploy usa Jenkins e il Jenkinsfile.", ["b"]), rec("b", "Il Jenkinsfile gira su srvsml01.")]);
	const weak = recall(index, "come funziona jenkins", { today: "2026-10-08", limit: 3, deepMinScore: 2 }).hits;
	assert.ok(weak.every((hit) => hit.via !== "deep"));
	const strong = recall(index, "come funziona jenkins", { today: "2026-10-08", limit: 3, deepMinScore: 0 }).hits;
	assert.ok(strong.some((hit) => hit.via === "deep"));
});

test("a memory shown over and over drops out unless it scores high; 'fai come meglio credi' is no request to match", async () => {
	const { dropRepeated } = await import("../src/recall.ts");
	const hit = (id: string, score: number) => ({ record: { id } as never, score });
	const counts = new Map<string, number>();
	for (let i = 0; i < 2; i++) assert.equal(dropRepeated([hit("r1", 0.5)], counts).length, 1);
	assert.equal(dropRepeated([hit("r1", 0.5)], counts).length, 0);
	assert.equal(dropRepeated([hit("r1", 0.8)], counts).length, 1);
	assert.equal(isSmallTalk("fai come meglio credi"), true);
});
