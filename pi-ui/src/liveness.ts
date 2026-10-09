/**
 * What a long command is doing, for the running step row: working (CPU, which program), waiting on disk, or silent and
 * idle (maybe stuck). Linux/WSL read /proc once a second, only while a command runs; elsewhere only "no output for Ns".
 * Also a note before a command known to be very slow (a scan of the whole disk). Nothing is ever changed or blocked.
 */
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

export interface Stat {
	pid: number;
	comm: string;
	state: string;
	ppid: number;
	/** utime + stime, in clock ticks (100 per second on Linux). */
	ticks: number;
}

export function parseStat(text: string): Stat | undefined {
	const open = text.indexOf("(");
	const close = text.lastIndexOf(")");
	if (open === -1 || close === -1) return undefined;
	const rest = text.slice(close + 2).split(" ");
	return { pid: Number(text.slice(0, open).trim()), comm: text.slice(open + 1, close), state: rest[0], ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]) };
}

const read = (path: string) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
};

/** Direct children of a process (every thread can spawn: all tasks are read). */
function children(pid: number): number[] {
	let tasks: string[];
	try {
		tasks = readdirSync(`/proc/${pid}/task`);
	} catch {
		return [];
	}
	return tasks.flatMap((task) => (read(`/proc/${pid}/task/${task}/children`) ?? "").trim().split(/\s+/).filter(Boolean).map(Number));
}

function descendants(pid: number, depth = 0): { pid: number; depth: number }[] {
	if (depth > 12) return [];
	return children(pid).flatMap((child) => [{ pid: child, depth: depth + 1 }, ...descendants(child, depth + 1)]);
}

/**
 * The process running a bash tool command, among the descendants of `root` (Pi): found by its command line, because
 * Pi has other long-lived children (MCP servers) that must not be mistaken for it. The shallowest match wins.
 */
export function findCommandProcess(root: number, command: string): number | undefined {
	// bash often exec's a single command: the process is then python3/node with its own argv, quotes and escapes gone.
	const plain = (text: string) => text.replace(/["'\\]/g, "").replace(/\s+/g, " ").trim();
	const needle = plain(command).slice(0, 80);
	if (!needle) return undefined;
	const matches = descendants(root)
		.filter(({ pid }) => plain((read(`/proc/${pid}/cmdline`) ?? "").replaceAll("\0", " ")).includes(needle))
		.sort((a, b) => a.depth - b.depth);
	return matches[0]?.pid;
}

export type Wait = "keyboard" | "network" | "pipe" | "timer";

/**
 * What a sleeping process waits for, from its kernel wait channel (/proc/<pid>/wchan) and its open file descriptors:
 * a terminal read, a socket (or an event loop with sockets open), a pipe from another process, a timer.
 */
export function waitReason(wchan: string, hasSocket: boolean, readsTty = false): Wait | undefined {
	if (/n_tty_read|tty_read/.test(wchan) || (readsTty && /wait_woken/.test(wchan))) return "keyboard";
	if (/sk_wait|tcp_|inet_|udp_|unix_stream|sock/.test(wchan) || (hasSocket && /ep_poll|epoll|poll|select|wait_woken|futex/.test(wchan))) return "network";
	if (/pipe_read|pipe_wait/.test(wchan)) return "pipe";
	if (/nanosleep|hrtimer|schedule_timeout/.test(wchan)) return "timer";
	return undefined;
}

export interface Sample {
	at: number;
	ticks: number;
	state: string;
	comm: string;
	wait?: Wait;
	/** CPU % of the whole process tree since the previous sample. */
	cpu?: number;
}

/** The tree of `pid`: CPU of all of it, state and name of the deepest (most recent) process — the one doing the work. */
export function sampleActivity(pid: number, previous?: Sample): Sample | undefined {
	const tree = [{ pid, depth: 0 }, ...descendants(pid)];
	const stats = tree.map(({ pid: id, depth }) => ({ depth, stat: parseStat(read(`/proc/${id}/stat`) ?? "") })).filter((item): item is { depth: number; stat: Stat } => Boolean(item.stat));
	if (stats.length === 0) return undefined;
	const ticks = stats.reduce((sum, item) => sum + item.stat.ticks, 0);
	const states = stats.map((item) => item.stat.state);
	const state = states.includes("R") ? "R" : states.includes("D") ? "D" : states[0];
	const leaf = [...stats].sort((a, b) => b.depth - a.depth)[0].stat;
	const at = Date.now();
	const cpu = previous && at > previous.at ? Math.max(0, Math.round(((ticks - previous.ticks) * 1000) / (at - previous.at))) : undefined;
	// The program's own name (python3, node, mongosh), not a thread name such as "MainThread".
	const argv0 = (read(`/proc/${leaf.pid}/cmdline`) ?? "").split("\0")[0];
	const name = argv0 ? (argv0.split("/").pop() ?? leaf.comm) : leaf.comm;
	return { at, ticks, state, comm: name, cpu, wait: leaf.state === "S" ? waitOf(leaf.pid) : undefined };
}

function waitOf(pid: number): Wait | undefined {
	const wchan = (read(`/proc/${pid}/wchan`) ?? "").trim();
	let hasSocket = false;
	let readsTty = false;
	try {
		for (const fd of readdirSync(`/proc/${pid}/fd`).slice(0, 64)) {
			let target = "";
			try {
				target = readlinkSync(`/proc/${pid}/fd/${fd}`);
			} catch {
				continue;
			}
			if (target.startsWith("socket:")) hasSocket = true;
			if (fd === "0" && /^\/dev\/(pts|tty)/.test(target)) readsTty = true;
		}
	} catch {
		// Not ours to read: only the wait channel then.
	}
	return waitReason(wchan, hasSocket, readsTty);
}

const SILENT_MS = 30_000;

/** The right column of a running command, or undefined while there is nothing worth saying. */
export function describeActivity(input: { cpu?: number; state?: string; comm?: string; wait?: Wait; silentMs: number }): { text: string; level: "ok" | "stuck" } | undefined {
	const seconds = Math.round(input.silentMs / 1000);
	if (input.state === undefined) return input.silentMs >= SILENT_MS ? { text: `nessun output da ${seconds}s · esc interrompe`, level: "stuck" } : undefined;
	const name = input.comm ? ` · ${input.comm}` : "";
	if (input.state === "R" || (input.cpu ?? 0) >= 5) return { text: `lavora · CPU ${input.cpu ?? 0}%${name}`, level: "ok" };
	if (input.state === "D") return { text: `aspetta il disco${name}`, level: "ok" };
	if (input.wait === "keyboard") return { text: `aspetta input da tastiera (non arriverà)${name} · esc interrompe`, level: "stuck" };
	if (input.wait === "network") return input.silentMs >= SILENT_MS ? { text: `aspetta la rete da ${seconds}s${name} · esc interrompe`, level: "stuck" } : { text: `aspetta la rete${name}`, level: "ok" };
	if (input.wait === "pipe") return { text: `aspetta un altro processo${name}`, level: "ok" };
	if (input.wait === "timer") return { text: `in pausa (timer)${name}`, level: "ok" };
	if (input.silentMs >= SILENT_MS) return { text: `fermo da ${seconds}s · CPU ${input.cpu ?? 0}%${name} · esc interrompe`, level: "stuck" };
	return { text: `in attesa${name}`, level: "ok" };
}

/** A note for commands that scan the whole disk (on WSL that includes the Windows drives, minutes long). */
export function slowCommandHint(command: string): string | undefined {
	const scansRoot = /(?:^|[;&|(]\s*)(?:find|du)\s+\/(?:\s|$)/.test(command) || /\bgrep\s+(?:-\w*r\w*\s+)(?:.*\s)?\/(?:\s|$|2>)/.test(command);
	const excludesMnt = /-xdev|-not\s+-path\s+['"]?\/mnt|--exclude-dir=\/?mnt|-prune/.test(command);
	if (scansRoot && !excludesMnt) return "scansiona tutto il disco (in WSL anche C:): può durare minuti";
	if (/\b(?:find|du|grep\s+-\w*r)\b[^|;&]*\/mnt\/[a-z]\b/.test(command)) return "legge i dischi Windows da WSL: lento";
	return undefined;
}
