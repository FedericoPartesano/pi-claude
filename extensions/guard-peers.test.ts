import { test } from "node:test";
import assert from "node:assert/strict";
import { PeerGuard } from "./guard/peers.ts";

const NOW = 1_000_000_000;
const files = new Map<string, number>();
const io = { mtime: (path: string) => files.get(path), dirty: () => true };

test("a file just written by someone else is flagged once; after the warning the write goes through", () => {
	const guard = new PeerGuard(io);
	files.set("/p/a.ts", NOW - 10_000);
	const first = guard.check("/p/a.ts", NOW);
	assert.ok(first && Math.round(first.ageMs / 1000) === 10);
	assert.equal(guard.check("/p/a.ts", NOW + 1000), undefined, "warned once for this change");
	files.set("/p/a.ts", NOW + 5000);
	assert.ok(guard.check("/p/a.ts", NOW + 6000), "a newer change by the peer is flagged again");
});

test("our own writes, our own bash commands, old changes and clean files are never flagged", () => {
	const guard = new PeerGuard(io);
	files.set("/p/own.ts", NOW - 5_000);
	guard.noteOwnWrite("/p/own.ts", NOW - 5_000);
	assert.equal(guard.check("/p/own.ts", NOW), undefined);
	files.set("/p/formatted.ts", NOW - 3_000);
	guard.noteBash(NOW - 4_000, NOW - 2_500);
	assert.equal(guard.check("/p/formatted.ts", NOW), undefined, "changed while our bash command ran");
	files.set("/p/old.ts", NOW - 10 * 60_000);
	assert.equal(guard.check("/p/old.ts", NOW), undefined, "stale work in progress is not a live peer");
	assert.equal(guard.check("/p/missing.ts", NOW), undefined, "a new file");
	const clean = new PeerGuard({ ...io, dirty: () => false });
	files.set("/p/committed.ts", NOW - 1000);
	assert.equal(clean.check("/p/committed.ts", NOW), undefined, "git sees no change");
});
