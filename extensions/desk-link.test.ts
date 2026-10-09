import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanStale, handleLine, socketPath, startLink } from "./desk-link.ts";

const info = (busy: boolean) => () => ({ pid: 7, cwd: "/p/shop", session: "/s/a.jsonl", busy });

test("hello tells who is there; a prompt is delivered, queued as follow-up while busy; bad input is refused", () => {
	const sent: [string, boolean][] = [];
	const send = (text: string, busy: boolean) => void sent.push([text, busy]);
	assert.deepEqual(handleLine(`{"type":"hello"}`, { info: info(false), send }), { type: "hello", pid: 7, cwd: "/p/shop", session: "/s/a.jsonl", busy: false });
	assert.deepEqual(handleLine(`{"type":"prompt","text":"  continua  "}`, { info: info(false), send }), { type: "ok", queued: false });
	assert.deepEqual(handleLine(`{"type":"prompt","text":"poi i test"}`, { info: info(true), send }), { type: "ok", queued: true });
	assert.deepEqual(sent, [["continua", false], ["poi i test", true]]);
	assert.equal((handleLine(`{"type":"prompt","text":""}`, { info: info(false), send }) as { type: string }).type, "error");
	assert.equal((handleLine("nope", { info: info(false), send }) as { type: string }).type, "error");
});

test("over a real socket, owner-only; stale sockets of dead Pis are removed", { skip: process.platform === "win32" }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "desk-link-"));
	writeFileSync(join(dir, "999999.sock"), "");
	const sent: string[] = [];
	const link = startLink({ info: info(false), send: (text) => void sent.push(text) }, dir);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.ok(!existsSync(join(dir, "999999.sock")), "stale socket removed");
	assert.equal(statSync(link.path).mode & 0o777, 0o600);
	const reply = await new Promise<string>((resolve) => {
		const socket = connect(socketPath(process.pid, dir), () => socket.write(`{"type":"prompt","text":"ciao dal desk"}\n`));
		socket.setEncoding("utf8");
		socket.on("data", (data: string) => (resolve(data), socket.end()));
	});
	assert.deepEqual(JSON.parse(reply), { type: "ok", queued: false });
	assert.deepEqual(sent, ["ciao dal desk"]);
	link.server.close();
	cleanStale(dir);
});
