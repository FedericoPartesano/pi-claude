import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PiRpc } from "../rpc.mjs";

const fake = fileURLToPath(new URL("./fake-pi.mjs", import.meta.url));

test("prompt, streamed text (with U+2028 inside), an extension dialog answered, settle; failed commands reject", async () => {
	const pi = new PiRpc({ command: process.execPath, args: [fake] });
	const events = [];
	pi.on("event", (event) => events.push(event));
	pi.on("ui", (request) => pi.answer(request.id, { confirmed: true }));
	const settled = new Promise((resolve) => pi.on("event", (event) => event.type === "agent_settled" && resolve()));
	pi.start();
	assert.deepEqual(await pi.prompt("ciao"), { disposition: "started" });
	await settled;
	assert.equal(events[0].assistantMessageEvent.delta, "eco: ciao   fine");
	assert.equal(events.find((event) => event.type === "tool_execution_start").args.confirmed, true);
	await assert.rejects(pi.send("get_state"), /non supportato/);
	pi.stop();
});
