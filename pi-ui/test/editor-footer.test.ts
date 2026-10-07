import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { frameEditor } from "../src/editor.ts";
import { renderFooter, type FooterInfo } from "../src/footer.ts";
import { readUsage } from "../src/usage.ts";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("frameEditor draws the cut-corner frame at the editor width", () => {
	for (const width of [40, 80, 120]) {
		const framed = frameEditor(["─".repeat(width), "❯ ciao", "─".repeat(width)], width, false);
		assert.match(strip(framed[0]), /^╱─ PROMPT ─+┐$/);
		assert.match(strip(framed[2]), /^└─+╱$/);
		assert.equal(visibleWidth(framed[0]), width);
		assert.equal(visibleWidth(framed[2]), width);
		assert.equal(framed[1], "❯ ciao");
	}
	assert.deepEqual(frameEditor(["solo"], 40, false), ["solo"]);
});

const info: FooterInfo = {
	statuses: new Map([["goal", "goal 2/5"], ["loop", "loop 5m · giro 3 · prossimo 04:12"], ["claude-code", "abbonamento 5h 34%"]]),
	project: "shop-api",
	branch: "main",
	changes: 2,
	fiveHour: 0.34,
	contextPercent: 41.2,
	model: "sonnet",
	thinking: "medium",
};

test("footer: session on the left, usage on the right, exact width", () => {
	for (const width of [40, 80, 120]) assert.equal(visibleWidth(renderFooter(info, width)), width);
	const wide = strip(renderFooter(info, 120));
	assert.match(wide, /^GOAL 2\/5  LOOP 5m · giro 3 · prossimo 04:12 {3}shop-api ⎇ main ✚2/);
	assert.match(wide, /5H 34% · CTX 41% · sonnet·medium$/);
	assert.doesNotMatch(wide, /abbonamento/);
	assert.doesNotMatch(strip(renderFooter(info, 80)), /shop-api/);
});

test("footer shows the memory status (first part) on wide terminals", () => {
	const withMemory = { ...info, statuses: new Map([...info.statuses, ["memory", "◇ 3 ricordi richiamati · 12 (2 📌)"]]) };
	assert.match(strip(renderFooter(withMemory, 140)), /shop-api ⎇ main ✚2 {2}◇ 3 ricordi richiamati /);
	assert.doesNotMatch(strip(renderFooter(withMemory, 140)), /12 \(2 📌\)/);
	for (const width of [40, 80, 140]) assert.equal(visibleWidth(renderFooter(withMemory, width)), width);
});

test("footer without session or usage data, and with overage", () => {
	const bare = strip(renderFooter({ ...info, statuses: new Map(), fiveHour: undefined, contextPercent: undefined, changes: 0 }, 120));
	assert.match(bare, /^shop-api ⎇ main /);
	assert.match(bare, /5H – · CTX – · sonnet·medium$/);
	assert.match(strip(renderFooter({ ...info, overage: true }, 120)), /⚠ EXTRA USAGE/);
});

test("readUsage reads the subscription file and survives a missing or broken one", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-usage-"));
	writeFileSync(join(dir, "ok.json"), JSON.stringify({ fiveHourUtilization: 0.72, sevenDayUtilization: 0.3, isUsingOverage: false }));
	writeFileSync(join(dir, "bad.json"), "{");
	assert.deepEqual(readUsage(join(dir, "ok.json")), { fiveHour: 0.72, sevenDay: 0.3, overage: false });
	assert.equal(readUsage(join(dir, "bad.json")), undefined);
	assert.equal(readUsage(join(dir, "missing.json")), undefined);
});
