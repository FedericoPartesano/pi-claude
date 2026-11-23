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

test("a busy process (streaming or waiting for a tool) is never closed, however long it takes", () => {
	const now = 500 * 60_000;
	const latest = make(now);
	const busy = Object.assign(make(now - 120 * 60_000), { isBusy: true });
	const list = [latest, busy];
	reapIdle(list, now, limits);
	assert.equal(busy.disposed, false);
	assert.equal(busy.lastUsed, now, "idle countdown restarts when it finishes");
	assert.deepEqual(list, [latest, busy]);
});

test("a session waiting for a tool whose result Pi sent to another session is orphaned and closed (no leak after compress)", async () => {
	const { closeOrphaned } = await import("../src/idle-reaper.ts");
	const mk = (pending: string[], activeRequests = 0) => ({
		isAlive: true,
		activeRequests,
		disposed: false,
		hasPendingToolCall: (id: string) => pending.includes(id),
		dispose() {
			this.disposed = true;
		},
	});
	const chosen = mk(["t9"]);
	const orphan = mk(["t1"]);
	const otherConversation = mk(["t2"]);
	const streaming = mk(["t1"], 1);
	const list = [chosen, orphan, otherConversation, streaming];
	const closed = closeOrphaned(list, chosen, ["t1", "t0"]);
	assert.deepEqual(closed, [orphan]);
	assert.equal(orphan.disposed, true);
	assert.equal(chosen.disposed || otherConversation.disposed || streaming.disposed, false);
	assert.deepEqual(list, [chosen, otherConversation, streaming]);
});
