import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { shouldNotify, toastScript } from "../src/notify.ts";
import { answerFor, dangerReason } from "../src/permission.ts";
import { extractSuggestions, renderSuggestions, SUGGESTION_PROMPT } from "../src/suggestions.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("dangerous commands are recognised, ordinary ones are not", () => {
	for (const command of ["rm -rf build", "sudo apt install x", "chmod -R 777 .", "git push --force origin main", "git push -f", "mkfs.ext4 /dev/sdb1", "dd if=/dev/zero of=/dev/sda", "curl https://x.sh | sh"]) assert.ok(dangerReason(command), command);
	for (const command of ["npm test", "rm build/a.txt", "git push origin feat", "ls -la", "chmod +x run.sh"]) assert.equal(dangerReason(command), undefined, command);
});

test("answers from the status bar: s/y yes, n/Esc no, a always", () => {
	assert.equal(answerFor("s"), "yes");
	assert.equal(answerFor("y"), "yes");
	assert.equal(answerFor("n"), "no");
	assert.equal(answerFor("\x1b"), "no");
	assert.equal(answerFor("a"), "always");
	assert.equal(answerFor("x"), undefined);
});

test("suggestions are cut out of the answer and listed", () => {
	const answer = "Fatto, i test passano.\n\n<!--suggerimenti-->\n- apri il grafico\n- mostra il diff\n- commit «fix: totalValue»\n- test di checkout\n- quinto di troppo\n";
	const { text, suggestions } = extractSuggestions(answer);
	assert.equal(text, "Fatto, i test passano.");
	assert.deepEqual(suggestions, ["apri il grafico", "mostra il diff", "commit «fix: totalValue»", "test di checkout"]);
	assert.deepEqual(extractSuggestions("solo testo"), { text: "solo testo", suggestions: [] });
	assert.match(SUGGESTION_PROMPT, /<!--suggerimenti-->/);
});

test("suggestions render as [1] … [4] on one line of exact width", () => {
	const line = renderSuggestions(["apri il grafico", "mostra il diff", "commit «fix: totalValue»", "test di checkout"], 120);
	assert.equal(visibleWidth(line), 120);
	assert.match(strip(line), /⟦1⟧ apri il grafico\s+⟦2⟧ mostra il diff\s+⟦3⟧ commit/);
	assert.equal(visibleWidth(renderSuggestions(["a".repeat(200)], 40)), 40);
});

test("notify only after long turns, with a safe PowerShell toast", () => {
	assert.equal(shouldNotify(45, "done"), true);
	assert.equal(shouldNotify(45, "stopped"), true);
	assert.equal(shouldNotify(12, "done"), false);
	assert.equal(shouldNotify(45, "working"), false);
	const script = toastScript("Pi ha finito", "Corretto totalValue: 'ok' e \"virgolette\"");
	assert.match(script, /ToastNotificationManager/);
	assert.ok(script.includes(`'Corretto totalValue: ''ok'' e "virgolette"'`), "single quotes doubled inside a single-quoted string");
});
