import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFooter } from "../src/footer.ts";

test("renderFooter: modalità senza permessi sempre visibile", () => {
	const base = { statuses: new Map<string, string>(), project: "p", changes: 0, model: "m", thinking: "t" };
	assert.match(renderFooter({ ...base, yolo: true }, 120), /SENZA PERMESSI/);
	assert.doesNotMatch(renderFooter(base, 120), /SENZA PERMESSI/);
});

test("renderFooter: badge Caveman con il livello, anche da spento", () => {
	const mk = (level?: string) => ({ statuses: new Map(level ? [["caveman", level]] : []), project: "p", changes: 0, model: "m", thinking: "t" });
	assert.match(renderFooter(mk("lite"), 120), /CAVEMAN LITE/);
	assert.match(renderFooter(mk("full"), 120), /CAVEMAN FULL/);
	assert.match(renderFooter(mk("off"), 120), /CAVEMAN OFF/);
	assert.doesNotMatch(renderFooter(mk(), 120), /CAVEMAN/);
});
