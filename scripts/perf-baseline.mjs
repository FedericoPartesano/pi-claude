#!/usr/bin/env node
// Measures an idle Pi (RPC mode, whole pi-claude package, fake Claude Code): startup time, RSS of Pi
// plus children, and CPU while idle. Usage: node scripts/perf-baseline.mjs [idleSeconds=15] [--json]
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const idle = Number(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : 15);
const asJson = process.argv.includes("--json");
const started = Date.now();
const pi = spawn(
	join(root, "pi-claude-code", "node_modules", ".bin", "pi"),
	["--mode", "rpc", "--no-session", ...(process.argv.includes("--bare") ? ["--no-extensions", "-e", join(root, "pi-claude-code")] : process.argv.includes("--only") ? ["--no-extensions", "-e", join(root, "pi-claude-code"), "-e", join(root, process.argv[process.argv.indexOf("--only") + 1])] : ["-e", root]), "--provider", "claude-code", "--model", "sonnet"],
	{
		stdio: ["pipe", "pipe", "ignore"],
		env: { ...process.env, PI_CLAUDE_BINARY: join(root, "pi-claude-code/test/fake-claude.mjs"), PI_TAB_STATUS: "0" },
	},
);
const tree = (pid) => {
	const out = execFileSync("ps", ["-eo", "pid,ppid,rss"], { encoding: "utf8" }).trim().split("\n").slice(1).map((l) => l.trim().split(/\s+/).map(Number));
	const kids = new Map();
	for (const [p, pp] of out) kids.set(pp, [...(kids.get(pp) ?? []), p]);
	const all = [pid];
	for (let i = 0; i < all.length; i++) for (const k of kids.get(all[i]) ?? []) all.push(k);
	const rss = out.filter(([p]) => all.includes(p)).reduce((s, [, , r]) => s + r, 0);
	return { pids: all, rssMb: Math.round(rss / 1024) };
};
const ticks = (pids) =>
	pids.reduce((s, p) => {
		try {
			const f = readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ");
			return s + Number(f[11]) + Number(f[12]);
		} catch {
			return s;
		}
	}, 0);

let buffer = "";
const ready = new Promise((resolve) => {
	pi.stdout.on("data", (d) => {
		buffer += d;
		if (buffer.includes('"type":"response"')) resolve();
	});
});
pi.stdin.write(JSON.stringify({ id: "s", type: "get_state" }) + "\n");
await Promise.race([ready, new Promise((r) => setTimeout(r, 60000))]);
const startupMs = Date.now() - started;
await new Promise((r) => setTimeout(r, 5000)); // let lazy work settle
const before = tree(pi.pid);
const first = new Map(before.pids.map((p) => [p, ticks([p])]));
const ticks0 = (pids) => pids.reduce((s, p) => s + (first.get(p) ?? 0), 0);
await new Promise((r) => setTimeout(r, idle * 1000));
const after = tree(pi.pid);
const alive = before.pids.filter((p) => after.pids.includes(p));
const cpuPct = alive.length ? (ticks(alive) - ticks0(alive)) / idle : 0;
const piRss = Math.round(Number(readFileSync(`/proc/${pi.pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1]) / 1024);
const f = readFileSync(`/proc/${pi.pid}/stat`, "utf8").split(") ")[1].split(" ");
const piCpuSeconds = Math.round(((Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14])) / 100) * 10) / 10;
const result = { piRssMb: piRss, piCpuSeconds, startupMs, rssMb: after.rssMb, processes: after.pids.length, idleCpuPct: Math.round(cpuPct * 10) / 10 };
pi.kill("SIGTERM");
console.log(asJson ? JSON.stringify(result) : `startup ${startupMs} ms | Pi ${piRss} MB, ${piCpuSeconds} s CPU totali | RSS ${result.rssMb} MB (${result.processes} processi) | CPU a riposo ${result.idleCpuPct}%`);
setTimeout(() => process.exit(0), 500);
