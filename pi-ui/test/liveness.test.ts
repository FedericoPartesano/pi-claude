import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describeActivity, findCommandProcess, parseStat, sampleActivity, slowCommandHint, waitReason } from "../src/liveness.ts";

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

test("describeActivity: an idle command says what it waits for (keyboard, network, another process, a timer)", () => {
	assert.deepEqual(describeActivity({ cpu: 0, state: "S", comm: "python3", wait: "keyboard", silentMs: 45_000 }), { text: "aspetta input da tastiera (non arriverà) · python3 · esc interrompe", level: "stuck" });
	assert.deepEqual(describeActivity({ cpu: 0, state: "S", comm: "mongosh", wait: "network", silentMs: 45_000 }), { text: "aspetta la rete da 45s · mongosh · esc interrompe", level: "stuck" });
	assert.deepEqual(describeActivity({ cpu: 0, state: "S", comm: "grep", wait: "pipe", silentMs: 10_000 }), { text: "aspetta un altro processo · grep", level: "ok" });
	assert.deepEqual(describeActivity({ cpu: 0, state: "S", comm: "sleep", wait: "timer", silentMs: 45_000 }), { text: "in pausa (timer) · sleep", level: "ok" });
});

test("waitReason: kernel wait channels and open sockets", () => {
	assert.equal(waitReason("n_tty_read", false), "keyboard");
	assert.equal(waitReason("wait_woken", false, true), "keyboard");
	assert.equal(waitReason("sk_wait_data", true), "network");
	assert.equal(waitReason("ep_poll", true), "network");
	assert.equal(waitReason("do_select", false), undefined);
	assert.equal(waitReason("pipe_read", false), "pipe");
	assert.equal(waitReason("hrtimer_nanosleep", false), "timer");
});

test("sampleActivity names the program by its command line (not a thread name) and reads its wait", { skip: process.platform !== "linux" }, async () => {
	const child = spawn("sleep", ["5"], { stdio: "ignore" });
	try {
		await new Promise((resolve) => setTimeout(resolve, 200));
		const sample = sampleActivity(child.pid!);
		assert.equal(sample?.comm, "sleep");
		assert.equal(sample?.wait, "timer");
	} finally {
		child.kill("SIGKILL");
	}
});

test("findCommandProcess: found even when bash exec'd the command (argv split, quotes gone)", { skip: process.platform !== "linux" }, async () => {
	const command = `python3 -c "import time; time.sleep(5)  # \\"pi-liveness\\""`;
	const child = spawn("bash", ["-c", command], { stdio: "ignore" });
	try {
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.equal(findCommandProcess(process.pid, command), child.pid);
	} finally {
		child.kill("SIGKILL");
	}
});
