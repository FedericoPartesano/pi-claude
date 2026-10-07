import { test } from "node:test";
import assert from "node:assert/strict";
import { teamStatus } from "../src/progress.ts";

test("team status for the footer and pi-ui's panel: task in progress out of the total", () => {
	assert.equal(teamStatus([], 4), "team 0/4 · avvio");
	const lines = ["finestra 5h al 30%: parallelismo 3", "▶ t1 implementer (sonnet) · tentativo 1: cart", "✓ t1 verificato", "▶ t2 tester (sonnet) · tentativo 1 · in parallelo: test"];
	assert.equal(teamStatus(lines, 4), "team 2/4 · t2 tester");
	assert.equal(teamStatus([...lines, "🔍 revisione"], 4), "team 4/4 · revisione");
	assert.equal(teamStatus([...lines, "🔧 giro correttivo 1"], 4), "team 4/4 · correzione");
});
