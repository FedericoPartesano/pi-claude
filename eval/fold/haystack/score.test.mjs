// node --test eval/fold/haystack/score.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

test("a replay resumed after the assistant's proposal takes it from the session file", () => {
	const dir = mkdtempSync(join(tmpdir(), "score-"));
	const events = [say("RISPOSTE:\n1) Nerofiume"), { type: "agent_settled" }];
	writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
	writeFileSync(join(dir, "spawns.log"), "");
	writeFileSync(join(dir, "turns.tsv"), "1\t1.0\tq\n");
	mkdirSync(join(dir, "sess"));
	const entry = (role, text) => JSON.stringify({ type: "message", message: { role, content: [{ type: "text", text }] } });
	const ask = "Proponi un nome in codice di una sola parola";
	writeFileSync(join(dir, "sess", "s.jsonl"), [entry("user", "leggi un file"), entry("assistant", "Fatto."), entry("user", ask), entry("assistant", "**Nerofiume**")].join("\n"));
	const truth = { abstain: "non dett", assistantTurn: 13, assistantPrompt: ask, quizzes: [[{ name: "nome in codice", re: "ASSISTANT:13" }]] };
	writeFileSync(join(dir, "truth.json"), JSON.stringify(truth));
	const out = JSON.parse(execFileSync("node", [join(here, "score.mjs"), dir, join(dir, "truth.json")], { encoding: "utf8" }));
	assert.equal(out.proposed, "Nerofiume");
	assert.equal(out.quizzes[0].score, "1/1");
});

test("a right value with a hedge after it is right; an abstention before a value is still an abstention", () => {
	const dir = mkdtempSync(join(tmpdir(), "score-"));
	const events = [say("RISPOSTE:\n1) 13750 ms, REQUEST_DEADLINE_MS; nessuna descrizione esplicita\n2) non detto (forse 25)"), { type: "agent_settled" }];
	writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
	writeFileSync(join(dir, "spawns.log"), "");
	writeFileSync(join(dir, "turns.tsv"), "1\t1.0\tq\n");
	const truth = { abstain: "non dett|nessun", assistantTurn: 0, quizzes: [[{ name: "deadline", re: "13[_.,]?750" }, { name: "slot", re: "\\b25\\b" }]] };
	writeFileSync(join(dir, "truth.json"), JSON.stringify(truth));
	const out = JSON.parse(execFileSync("node", [join(here, "score.mjs"), dir, join(dir, "truth.json")], { encoding: "utf8" }));
	assert.deepEqual(out.quizzes[0].missed, ["slot:abstained"]);
});
