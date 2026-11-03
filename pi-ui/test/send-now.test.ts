import assert from "node:assert/strict";
import { test } from "node:test";
import { sendNow, trackSession, trackedSession } from "../src/send-now.ts";

const fake = (streaming: boolean) => {
	const steered: string[] = [];
	return {
		steered,
		isStreaming: streaming,
		async prompt() {},
		clearQueue: () => ({ steering: ["s1"], followUp: ["f1", "f2"] }),
		async steer(text: string) { if (text === "/cmd") throw new Error("command"); steered.push(text); },
	};
};

test("sendNow: follow-up e testo digitato diventano steering, in ordine", async () => {
	const s = fake(true);
	assert.deepEqual(await sendNow(s, " ora "), { sent: 4 });
	assert.deepEqual(s.steered, ["s1", "f1", "f2", "ora"]);
});

test("sendNow: fermo o senza sessione non fa nulla", async () => {
	const s = fake(false);
	assert.deepEqual(await sendNow(s), { sent: 0, reason: "idle" });
	assert.deepEqual(s.steered, []);
	assert.deepEqual(await sendNow(undefined), { sent: 0, reason: "no-session" });
});

test("sendNow: un comando non accodabile non perde gli altri", async () => {
	const s = fake(true);
	assert.deepEqual(await sendNow(s, "/cmd"), { sent: 3 });
});

test("trackSession ricorda l'ultima sessione e non si applica due volte", async () => {
	const proto = { async prompt() {} };
	assert.equal(trackSession(proto), true);
	assert.equal(trackSession(proto), false);
	const obj = Object.create(proto);
	await obj.prompt("x");
	assert.equal(trackedSession(), obj);
});
