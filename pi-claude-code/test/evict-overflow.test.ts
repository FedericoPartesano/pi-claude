import { test } from "node:test";
import assert from "node:assert/strict";
import { evictOverflow } from "../src/idle-reaper.ts";

const make = (name: string, known: number, busy = false) => ({
	name,
	isAlive: true,
	isBusy: busy,
	knownFingerprints: Array.from({ length: known }, String),
	disposed: false,
	dispose() {
		this.disposed = true;
	},
});

// Long chat D2-off: one-shot side requests (summaries, 1 message each) pushed the main session out of the pool while it
// waited for a tool result; Claude Code got "claude session disposed" and the next turn paid a full --resume.
test("a session waiting on a tool call is never evicted; one-shot sessions go first", () => {
	const sideNew = make("side-new", 0, true);
	const sideOld = make("side-old", 2);
	const main = make("main", 24, true);
	const title = make("title", 2);
	const list = [sideNew, main, sideOld, title];
	const closed = evictOverflow(list, 3);
	assert.deepEqual(closed.map((s) => s.name), ["title"]);
	assert.deepEqual(list.map((s) => s.name), ["side-new", "main", "side-old"]);
	evictOverflow([make("x", 0), ...list], 3);
	assert.equal(main.disposed, false);
	assert.equal(sideOld.disposed, true);
});

test("a long idle conversation outlives a newer one-shot", () => {
	const fresh = make("fresh", 0, true);
	const oneShot = make("one-shot", 2);
	const main = make("main", 30);
	const list = [fresh, oneShot, main];
	evictOverflow(list, 2);
	assert.deepEqual(list.map((s) => s.name), ["fresh", "main"]);
});

test("dead sessions go before anything else; with every session busy the pool may overflow", () => {
	const dead = { ...make("dead", 40), isAlive: false };
	const list = [make("a", 1, true), make("b", 9), dead];
	evictOverflow(list, 2);
	assert.deepEqual(list.map((s) => s.name), ["a", "b"]);
	const busy = [make("a", 1, true), make("b", 9, true), make("c", 9, true)];
	assert.deepEqual(evictOverflow(busy, 2), []);
	assert.equal(busy.length, 3);
});

test("among equals the least recently used goes", () => {
	const list = [make("new", 10), make("mid", 10), make("old", 10)];
	evictOverflow(list, 2);
	assert.deepEqual(list.map((s) => s.name), ["new", "mid"]);
});
