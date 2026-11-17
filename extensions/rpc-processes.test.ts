import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { isLaunch, portOf, coreOf, findPid, newRow, refresh, visible, processLines } from "../prototype/rpc-chat/processes.mjs";

const S = new Proxy({}, { get: () => "" });
const fit = (t: string, w: number) => t.slice(0, w);

test("isLaunch: background markers only", () => {
	for (const c of ["npm run dev &", "nohup node s.js > log 2>&1 &", "setsid python -m http.server 8000", "a & b", "(srv &)"]) assert.ok(isLaunch(c), c);
	for (const c of ["ls && echo hi", "echo a > b", "node --test", "cat a | grep b", "echo 1 >&2"]) assert.ok(!isLaunch(c), c);
});

test("portOf and coreOf", () => {
	assert.equal(portOf("python -m http.server --port 8123 &"), 8123);
	assert.equal(portOf("PORT=3000 npm start &"), 3000);
	assert.equal(portOf("node s.js &", "listening on http://localhost:5173/"), 5173);
	assert.equal(portOf("node s.js &"), undefined);
	assert.equal(coreOf("PORT=3000 nohup node server.js > out.log 2>&1 &"), "node server.js");
	assert.equal(coreOf("cd x && npm run dev &"), "cd x");
});

test("real background process: pid found, up, then down after kill", async () => {
	const child = spawn("sleep", ["4321"], { detached: true, stdio: "ignore" });
	child.unref();
	const row = newRow(1, "nohup sleep 4321 > /dev/null 2>&1 &", "", 1000, [process.pid]);
	assert.equal(row.pid, child.pid);
	assert.equal(row.state, "up");
	assert.equal(await refresh([row], 2000), false);
	process.kill(child.pid!);
	await new Promise((r) => setTimeout(r, 200));
	child.pid && (await new Promise((r) => setTimeout(r, 100)));
	const rows = [row];
	await refresh(rows, 3000);
	assert.equal(row.state, "down");
	assert.equal(row.downAt, 3000);
	assert.deepEqual(visible(rows, 3000 + 130000), []);
	assert.equal(visible(rows, 4000).length, 1);
});

test("findPid ignores sh -c wrappers; lines show state", () => {
	assert.equal(findPid("zz-no-such-command-zz"), undefined);
	const up = { command: "node s.js", port: 3000, pid: 7, since: 0, state: "up" };
	const down = { command: "node t.js", pid: 8, since: 0, state: "down", downAt: 5000 };
	const l = processLines([up, down], 80, 65000, S, fit);
	assert.match(l[0], /:3000 · pid 7 · attivo da 1m05/);
	assert.match(l[2], /FERMO da 1m00/);
});
