import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describeActivity, findCommandProcess, parseStat, sampleActivity, slowCommandHint } from "../src/liveness.ts";

test("parseStat: name with spaces and parentheses, state, CPU ticks", () => {
	const stat = parseStat("4242 (my (odd) prog) S 1 4242 4242 0 -1 4194304 100 0 0 0 250 50 0 0 20 0 1 0 100 0 0");
	assert.deepEqual(stat, { pid: 4242, comm: "my (odd) prog", state: "S", ppid: 1, ticks: 300 });
});

test("describeActivity: working, waiting on disk or network, silent and idle (maybe stuck)", () => {
	assert.deepEqual(describeActivity({ cpu: 92, state: "R", comm: "find", silentMs: 70_000 }), { text: "lavora · CPU 92% · find", level: "ok" });
	assert.deepEqual(describeActivity({ cpu: 3, state: "D", comm: "find", silentMs: 20_000 }), { text: "aspetta il disco · find", level: "ok" });
	assert.deepEqual(describeActivity({ cpu: 0, state: "S", comm: "curl", silentMs: 5_000 }), { text: "in attesa · curl", level: "ok" });
	assert.deepEqual(describeActivity({ cpu: 0, state: "S", comm: "npm", silentMs: 45_000 }), { text: "fermo da 45s · CPU 0% · npm · esc interrompe", level: "stuck" });
	assert.deepEqual(describeActivity({ silentMs: 45_000 }), { text: "nessun output da 45s · esc interrompe", level: "stuck" }, "no /proc (Windows, macOS)");
	assert.equal(describeActivity({ silentMs: 3_000 }), undefined);
});

test("slowCommandHint: whole-disk scans warn (on WSL they read the Windows drives too); scoped ones do not", () => {
	assert.match(slowCommandHint("find / -maxdepth 6 -name '*.json'") ?? "", /tutto il disco/);
	assert.match(slowCommandHint("cd x && grep -rn foo / 2>/dev/null") ?? "", /tutto il disco/);
	assert.match(slowCommandHint("find /mnt/c/Users -name x") ?? "", /dischi Windows/);
	assert.equal(slowCommandHint("find . -name '*.ts'"), undefined);
	assert.equal(slowCommandHint("find / -xdev -maxdepth 2 -name x -not -path '/mnt/*'"), undefined);
	assert.equal(slowCommandHint("ls /"), undefined);
});

test("findCommandProcess + sampleActivity on a real child: found by its command line, CPU measured", { skip: process.platform !== "linux" }, async () => {
	const child = spawn("bash", ["-c", "while :; do :; done # pi-liveness-probe"], { stdio: "ignore" });
	try {
		await new Promise((resolve) => setTimeout(resolve, 300));
		const pid = findCommandProcess(process.pid, "while :; do :; done # pi-liveness-probe");
		assert.equal(pid, child.pid);
		const first = sampleActivity(pid!);
		await new Promise((resolve) => setTimeout(resolve, 400));
		const second = sampleActivity(pid!, first);
		assert.ok(second && second.cpu !== undefined && second.cpu > 30, `cpu ${second?.cpu}`);
		assert.equal(findCommandProcess(process.pid, "a command nobody runs"), undefined);
	} finally {
		child.kill("SIGKILL");
	}
});
