import assert from "node:assert/strict";
import { test } from "node:test";
import { sendNow, trackSession, trackedSession } from "../src/send-now.ts";

const fake = (streaming: boolean, queue = { steering: ["s1"], followUp: ["f1", "f2"] }) => {
	const steered: string[] = [];
	const prompted: string[] = [];
	const s = {
		steered,
		prompted,
		aborted: 0,
		isStreaming: streaming,
		async prompt(text: string) { prompted.push(text); },
		clearQueue: () => queue,
		async steer(text: string) { if (text === "/cmd") throw new Error("command"); steered.push(text); },
		async abort() { s.aborted++; s.isStreaming = false; },
	};
	return s;
};

test("sendNow: con un bash in corso lo sposta in background e manda tutto come steering, in ordine", async () => {
	const s = fake(true);
	assert.deepEqual(await sendNow(s, " ora ", () => 1), { sent: 4, moved: 1 });
	assert.deepEqual(s.steered, ["s1", "f1", "f2", "ora"]);
	assert.equal(s.aborted, 0);
});

test("sendNow: senza nulla da spostare non interrompe e rimette la coda come steering", async () => {
	const s = fake(true);
	assert.deepEqual(await sendNow(s, "ora"), { sent: 4, moved: 0 });
	assert.equal(s.aborted, 0);
	assert.deepEqual(s.prompted, []);
	assert.deepEqual(s.steered, ["s1", "f1", "f2", "ora"]);
});

test("sendNow: coda vuota non stacca né interrompe", async () => {
	const s = fake(true, { steering: [], followUp: [] });
	let detached = 0;
	assert.deepEqual(await sendNow(s, " ", () => ++detached), { sent: 0, reason: "empty" });
	assert.equal(detached, 0);
	assert.equal(s.aborted, 0);
});

test("sendNow: fermo o senza sessione non fa nulla", async () => {
	const s = fake(false);
	assert.deepEqual(await sendNow(s), { sent: 0, reason: "idle" });
	assert.deepEqual(s.steered, []);
	assert.deepEqual(await sendNow(undefined), { sent: 0, reason: "no-session" });
});

test("sendNow: un comando non accodabile non perde gli altri", async () => {
	const s = fake(true);
	assert.deepEqual(await sendNow(s, "/cmd", () => 1), { sent: 3, moved: 1 });
});

test("trackSession ricorda l'ultima sessione e non si applica due volte", async () => {
	const proto = { async prompt() {} };
	assert.equal(trackSession(proto), true);
	assert.equal(trackSession(proto), false);
	const obj = Object.create(proto);
	await obj.prompt("x");
	assert.equal(trackedSession(), obj);
});
