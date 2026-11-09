import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { isBusy, markBusy, newCounter, waitIdle } from "../src/inflight.ts";

test("a running inference makes the process busy until it ends; an exited worker no longer counts", () => {
	const counter = newCounter();
	const worker = new EventEmitter();
	counter.attach(worker);
	assert.equal(isBusy(), false);
	const done = markBusy(counter.buffer);
	assert.equal(isBusy(), true);
	done();
	assert.equal(isBusy(), false);
	markBusy(counter.buffer); // a terminated worker never decrements
	assert.equal(isBusy(), true);
	worker.emit("exit");
	assert.equal(isBusy(), false);
	const started = Date.now();
	waitIdle(2000);
	assert.ok(Date.now() - started < 500);
});
