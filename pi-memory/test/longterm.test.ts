import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "./longterm.ts";

test("a simulated year: active memories bounded, rare rules kept, closed topics still found deep, tokens constant", () => {
	const months = simulate(365).slice(0, 11);
	const late = months.filter((m) => m.day >= 180);
	assert.ok(late.every((m) => m.active <= 600), `active ${late.map((m) => m.active)}`);
	assert.ok(months[months.length - 1].stored < months[8].stored + 100, "the store stops growing once forgetting keeps pace");
	assert.ok(months.every((m) => m.rulesFound === m.rulesAsked), "rare but important rules always recalled");
	assert.ok(late.every((m) => m.closedFound === m.closed), "topics closed months ago found by a deep search");
	assert.ok(months.every((m) => m.foundShare >= 0.85), `newest memory of an active topic in the cues: ${months.map((m) => Math.round(m.foundShare * 100))}`);
	assert.ok(months.every((m) => m.maxTokens <= 320), "tokens per request constant");
});
