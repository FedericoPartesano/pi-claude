import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadTracker } from "./lean/reread.ts";

test("an unchanged re-read of the same range is replaced by a short note; a changed file or another range is not", () => {
	const tracker = new ReadTracker();
	assert.equal(tracker.check({ path: "/p/a.ts", offset: undefined, limit: undefined, content: "v1" }), undefined, "first read passes");
	assert.match(tracker.check({ path: "/p/a.ts", offset: undefined, limit: undefined, content: "v1" }) ?? "", /invariato dalla lettura 1/);
	assert.equal(tracker.check({ path: "/p/a.ts", offset: 10, limit: 20, content: "part" }), undefined, "another range passes");
	assert.equal(tracker.check({ path: "/p/a.ts", offset: undefined, limit: undefined, content: "v2" }), undefined, "changed content passes");
	assert.match(tracker.check({ path: "/p/a.ts", offset: undefined, limit: undefined, content: "v2" }) ?? "", /invariato dalla lettura 4/);
});

test("after a compaction the model no longer has the content: everything passes again", () => {
	const tracker = new ReadTracker();
	tracker.check({ path: "/p/a.ts", content: "v1" });
	tracker.reset();
	assert.equal(tracker.check({ path: "/p/a.ts", content: "v1" }), undefined);
});

test("small reads are never replaced (the note would not save anything)", () => {
	const tracker = new ReadTracker();
	tracker.check({ path: "/p/tiny", content: "ok" , minChars: 200 });
	assert.equal(tracker.check({ path: "/p/tiny", content: "ok", minChars: 200 }), undefined);
});
