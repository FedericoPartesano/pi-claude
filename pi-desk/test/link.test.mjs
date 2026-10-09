import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { linkRequest } from "../link.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { startLink } = await import(join(repo, "extensions/desk-link.ts"));

test("Pi Desk talks to a terminal Pi through desk-link: hello, prompt; a Pi without it is explained", { skip: process.platform === "win32" }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "desk-"));
	const sent = [];
	const link = startLink({ info: () => ({ pid: process.pid, cwd: "/p", session: "/s/x.jsonl", busy: true }), send: (text) => sent.push(text) }, dir);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal((await linkRequest(process.pid, { type: "hello" }, { dir })).session, "/s/x.jsonl");
	assert.deepEqual(await linkRequest(process.pid, { type: "prompt", text: "aggiungi i test" }, { dir }), { type: "ok", queued: true });
	assert.deepEqual(sent, ["aggiungi i test"]);
	await assert.rejects(linkRequest(424242, { type: "hello" }, { dir }), /riavvialo/);
	link.server.close();
});
