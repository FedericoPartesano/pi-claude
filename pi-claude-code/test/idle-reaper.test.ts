import { test } from "node:test";
import assert from "node:assert/strict";
import { reapIdle, reapLimits, type Reapable } from "../src/idle-reaper.ts";

const limits = { otherMs: 5 * 60_000, latestMs: 60 * 60_000 };
const make = (lastUsed: number): Reapable & { disposed: boolean } => ({
	lastUsed,
	isAlive: true,
	disposed: false,
	dispose() {
		this.disposed = true;
	},
});

test("an idle secondary process is closed, the latest one stays (so the conversation in front answers at once)", () => {
	const now = 100 * 60_000;
	const latest = make(now - 20 * 60_000);
	const other = make(now - 10 * 60_000);
	const list = [latest, other];
	reapIdle(list, now, limits);
	assert.equal(latest.disposed, false);
	assert.equal(other.disposed, true);
	assert.deepEqual(list, [latest]);
});

test("the latest process is closed too after the long limit, and a recent secondary one is kept", () => {
	const now = 200 * 60_000;
	const latest = make(now - 61 * 60_000);
	const other = make(now - 1 * 60_000);
	const list = [latest, other];
	reapIdle(list, now, limits);
	assert.equal(latest.disposed, true);
	assert.equal(other.disposed, false);
	assert.deepEqual(list, [other]);
});

test("limits come from the environment, 0 means close at the first check", () => {
	assert.deepEqual(reapLimits({}), limits);
	assert.equal(reapLimits({ PI_CLAUDE_IDLE_OTHER_MIN: "0" }).otherMs, 0);
	assert.equal(reapLimits({ PI_CLAUDE_IDLE_LATEST_MIN: "abc" }).latestMs, 60 * 60_000);
});
