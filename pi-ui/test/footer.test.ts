import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFooter } from "../src/footer.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

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

test("renderFooter: INTENT con i punti fatti", () => {
	const info = { statuses: new Map([["intent", "3/7"]]), project: "p", changes: 0, model: "m", thinking: "t" };
	assert.match(renderFooter(info, 120).replace(/\x1b\[[0-9;]*m/g, ""), /INTENT 3\/7/);
});

test("renderFooter: versioni di Pi e di pi-claude fisse a destra, più corte se lo spazio è poco", () => {
	const info = { statuses: new Map<string, string>(), project: "p", changes: 0, model: "m", thinking: "t", versions: { pi: "1.2.0", own: "0.2.0", commit: "03c1b55" } };
	const plain = (width: number) => renderFooter(info, width).replace(/\x1b\[[0-9;]*m/g, "");
	assert.match(plain(140), /pi 1\.2\.0 · pi-claude 0\.2\.0 \(03c1b55\)$/);
	assert.match(plain(100), /pi 1\.2\.0 · pi-claude 0\.2\.0$/);
	assert.doesNotMatch(plain(80), /pi-claude/);
	assert.doesNotMatch(renderFooter({ ...info, versions: undefined }, 140), /pi-claude/);
	for (const width of [80, 100, 140]) assert.equal(visibleWidth(renderFooter(info, width)), width);
});
