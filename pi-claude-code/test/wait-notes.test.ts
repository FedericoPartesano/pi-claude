import assert from "node:assert/strict";
import { test } from "node:test";
import { limitNote, retryNote } from "../src/claude-session.ts";

test("api_retry becomes a short note with attempt, delay and HTTP status", () => {
	assert.equal(retryNote({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 1208, error_status: 529 }), "api retry 2/10 in 1s (HTTP 529)");
	assert.equal(retryNote({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 502, error_status: null }), "api retry 1/10 in 1s");
});

test("only a rejected status is a usage-limit note, with the nearest reset", () => {
	const now = 1_000_000_000_000;
	assert.equal(limitNote({ status: "allowed" }, now), undefined);
	assert.equal(limitNote({ status: "allowed_warning" }, now), undefined);
	assert.equal(limitNote({ status: "rejected" }, now), "usage limit reached");
	const info = { status: "rejected", unifiedWindows: { seven_day: { resetsAt: now / 1000 + 3 * 86400 }, five_hour: { resetsAt: now / 1000 + 7800 } } };
	assert.equal(limitNote(info, now), "usage limit reached · resets in 2h10m");
});
