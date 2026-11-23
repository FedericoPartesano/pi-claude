// node --test eval/fold/haystack/score.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const here = new URL(".", import.meta.url).pathname;
const say = (text) => ({ type: "message_end", message: { role: "assistant", usage: {}, content: [{ type: "text", text }] } });

test("a quiz answered twice in one turn (recall nudge) is scored on the last answer", () => {
	const dir = mkdtempSync(join(tmpdir(), "score-"));
	const events = [say("RISPOSTE:\n1) non detto\n2) non detto"), say("RISPOSTE:\n1) 25\n2) non detto"), { type: "agent_settled" }];
	writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
	writeFileSync(join(dir, "spawns.log"), "");
	writeFileSync(join(dir, "turns.tsv"), "1\t1.0\tq\n");
	const truth = { abstain: "non dett", assistantTurn: 0, quizzes: [[{ name: "slot", re: "\\b25\\b" }, { name: "tel", re: "ABSTAIN" }]] };
	writeFileSync(join(dir, "truth.json"), JSON.stringify(truth));
	const out = JSON.parse(execFileSync("node", [join(here, "score.mjs"), dir, join(dir, "truth.json")], { encoding: "utf8" }));
	assert.equal(out.quizzes[0].score, "2/2");
});
