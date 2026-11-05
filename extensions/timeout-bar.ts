/**
 * Progress bars for the timeouts running right now, in a panel above the editor: the bash tool's own `timeout`
 * argument, a `timeout N cmd` inside the command, the total of the `sleep N` calls in the command, and the team agents (pi-team, which reports them on the
 * `timeout-bar:set` / `timeout-bar:clear` events). Nothing is rewritten and nothing is added to the prompt.
 * The bridge's MCP_TOOL_TIMEOUT is 24 h on purpose, so it gets no bar. PI_TIMEOUT_BAR=0 turns it off.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { barCells } from "./test-monitor/views.ts";
import { C, type Colors, duration, fg, truncateToWidth, useColors } from "./test-monitor/render.ts";

export interface Deadline {
	key: string;
	label: string;
	startedAt: number;
	timeoutMs: number;
	/** File the command is going to read or is writing to while it waits (sleep): its last lines are shown under the bar. */
	watch?: string;
	/** Words that identify the process the command waits for (script names, runner names): matched against `ps`. */
	probe?: string[];
}

const UNIT: Record<string, number> = { "": 1, s: 1, m: 60, h: 3600, d: 86400 };

/** Every `timeout [opts] DURATION cmd` of a command line, in milliseconds. */
export function shellTimeouts(command: string): { ms: number; text: string }[] {
	const found: { ms: number; text: string }[] = [];
	const pattern = /(?:^|[;&|(]\s*|\b(?:sudo|time|nohup)\s+)timeout\s+((?:(?:-[ks]\s+\S+|-\S+)\s+)*)(\d+(?:\.\d+)?)([smhd]?)(?=\s|$)([^;&|]*)/g;
	for (const match of command.matchAll(pattern)) {
		const ms = Number(match[2]) * UNIT[match[3]] * 1000;
		if (ms > 0) found.push({ ms, text: (match[4] ?? "").trim() });
	}
	return found;
}

/** Total of the `sleep DURATION...` calls of a command line, in milliseconds (`sleep 1m 30s` adds both arguments). */
export function shellSleepMs(command: string): number {
	let total = 0;
	for (const match of command.matchAll(/(?:^|[;&|(]\s*|\b(?:sudo|time|nohup|do|then)\s+)sleep\s+((?:\d+(?:\.\d+)?[smhd]?\s*)+)(?=$|[\s;&|)])/g)) {
		for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)([smhd]?)/g)) total += Number(part[1]) * UNIT[part[2]] * 1000;
	}
	return total;
}

/** Colour by how much of the budget is gone: calm, warning, about to fire. */
export const levelColor = (fraction: number) => (fraction >= 0.9 ? C.err : fraction >= 0.75 ? C.warn : C.cyan);

/**
 * The file a waiting command (`sleep 60; tail -30 /tmp/x.log`, `(nohup cmd > /tmp/x.log 2>&1 &); sleep 200`) is about to
 * look at: the file `tail`/`cat` reads, else the target of a plain redirect. `cd` with a plain path is followed.
 */
export function watchedFile(command: string, cwd: string): string | undefined {
	let dir = cwd;
	let redirect: string | undefined;
	for (const raw of command.replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\b/g, "").split(/&&|;|\n|\|/)) {
		const stage = raw.trim().replace(/^\(+/, "").replace(/\)+$/, "");
		const move = /^cd\s+("[^"]+"|'[^']+'|[^\s$~`*]+)$/.exec(stage);
		if (move) {
			dir = resolve(dir, move[1].replace(/^["']|["']$/g, ""));
			continue;
		}
		const read = /^(?:tail|cat|head)\s+(.*)$/.exec(stage);
		if (read) {
			const file = read[1].split(/\s+/).filter((token) => token && !token.startsWith("-") && !/^\d+$/.test(token)).pop();
			if (file && !/[$~`*]/.test(file)) return resolve(dir, file.replace(/^["']|["']$/g, ""));
		}
		const out = /(?:^|\s)(?:&>>?|1?>>?)\s*([^\s&|;<>()$~`*]+)/.exec(stage);
		if (out && out[1] !== "/dev/null" && !redirect) redirect = resolve(dir, out[1].replace(/^["']|["']$/g, ""));
	}
	return redirect;
}

const RUNNER_WORDS = /\b(vitest|jest|pytest|playwright|cypress|mocha|tsc|cargo|gradle|webpack|vite|next)\b/g;

/** Script and runner names of a waiting command (and the `pgrep -f` pattern), used to find its process in `ps`. */
export function probeTokens(command: string): string[] {
	const text = command.replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\b/g, "");
	const found = new Set<string>();
	for (const match of text.matchAll(/pgrep\s+(?:-\w+\s+)*['"]?([\w./-]+)['"]?/g)) found.add(basename(match[1]));
	for (const token of text.split(/[\s;&|()<>'"]+/)) if (/\.(?:[cm]?[jt]sx?|py|sh)$/.test(token) && !/^\/tmp\/.*\.log$/.test(token)) found.add(basename(token));
	for (const match of text.matchAll(RUNNER_WORDS)) found.add(match[1]);
	return [...found].slice(0, 6);
}

export interface Live {
	pid: number;
	seconds: number;
	cpu: number;
	args: string;
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "sleep", "ps", "pgrep", "tail", "cat", "head", "grep", "cut", "setsid"]);
const etimeSeconds = (etime: string) => {
	const [days, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
	const parts = rest.split(":").map(Number);
	while (parts.length < 3) parts.unshift(0);
	return Number(days) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
};

/** Rows of `ps -axo pid=,etime=,pcpu=,args=` whose command line contains one of the tokens; shells and helpers are left out. */
export function parsePs(text: string, tokens: string[], selfPid: number): Live[] {
	const out: Live[] = [];
	for (const line of text.split("\n")) {
		const match = /^\s*(\d+)\s+(\S+)\s+([\d.,]+)\s+(.+)$/.exec(line);
		if (!match) continue;
		const pid = Number(match[1]);
		const args = match[4].trim();
		if (pid === selfPid || SHELLS.has(basename(args.split(/\s+/)[0]))) continue;
		if (!tokens.some((token) => args.includes(token))) continue;
		out.push({ pid, seconds: etimeSeconds(match[2]), cpu: Number(match[3].replace(",", ".")), args });
	}
	return out;
}

/** Up to two live-process rows for the bar; none alive says so. */
export function liveLines(live: Live[] | undefined, width: number): string[] {
	if (!live) return [];
	if (!live.length) return [truncateToWidth(`${fg(C.dim, "  ⚙")} ${fg(C.warn, "no matching process alive")}`, width)];
	return live.slice(0, 2).map((item) => truncateToWidth(`${fg(C.dim, "  ⚙")} ${fg(C.dim, `pid ${item.pid} · ${duration(item.seconds * 1000)} · cpu ${Math.round(item.cpu)}% ·`)} ${fg(C.text, item.args)}`, width));
}

/** Last non-empty lines of a file (at most `count`), its size and age; a missing file says so. */
export function watchLines(file: string, width: number, now: number, count = 2): string[] {
	if (!existsSync(file)) return [truncateToWidth(`${fg(C.dim, "  ↳")} ${fg(C.dim, `${file}: not created yet`)}`, width)];
	let text = "";
	let age = 0;
	let size = 0;
	try {
		const fd = openSync(file, "r");
		try {
			const stat = fstatSync(fd);
			size = stat.size;
			age = Math.max(0, now - stat.mtimeMs);
			const bytes = Math.min(size, 4096);
			const buffer = Buffer.alloc(bytes);
			readSync(fd, buffer, 0, bytes, size - bytes);
			text = buffer.toString("utf8");
		} finally {
			closeSync(fd);
		}
	} catch {}
	const lines = text.split(/\r?\n/).map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()).filter(Boolean).slice(-count);
	const name = file.split("/").pop() ?? file;
	const head = `${fg(C.dim, "  ↳")} ${fg(C.dim, `${name} · ${(size / 1024).toFixed(1)} KB · ${age < 2000 ? "writing now" : `quiet for ${duration(age)}`}`)}`;
	return [truncateToWidth(head, width), ...(lines.length ? lines : ["(empty)"]).map((line) => truncateToWidth(`${fg(C.dim, "    ")}${fg(C.text, line)}`, width))];
}

/** One row: `⏱ label  ████░░░░  12s / 30s`, exactly `width` cells wide at most. */
export function renderDeadline(deadline: Deadline, width: number, now: number): string {
	const elapsed = Math.max(0, now - deadline.startedAt);
	const fraction = Math.min(1, elapsed / deadline.timeoutMs);
	const color = levelColor(fraction);
	const clock = `${duration(Math.min(elapsed, deadline.timeoutMs))} / ${duration(deadline.timeoutMs)}`;
	const label = truncateToWidth(deadline.label, Math.max(8, Math.floor(width / 3)));
	const used = 2 + [...label].length + 2 + 2 + clock.length + 6;
	const cells = Math.max(6, Math.min(40, width - used));
	return truncateToWidth(`${fg(color, "⏱")} ${fg(C.text, label)}  ${barCells(cells, fraction, 0, color)}  ${fg(color, `${Math.round(fraction * 100)}%`)} ${fg(C.dim, clock)}`, width);
}

export default function timeoutBar(pi: ExtensionAPI) {
	if (process.env.PI_TIMEOUT_BAR === "0" || process.env.PI_UI_LIVE === "0") return;
	const active = new Map<string, Deadline>();
	let tui: { requestRender(): void } | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	const live = new Map<string, Live[]>();
	let polling = false;
	// Processes matching the waiting commands, read from `ps` every 2 s (Linux, macOS, WSL; not native Windows).
	const poll = () => {
		const probes = [...active.values()].filter((deadline) => deadline.probe?.length);
		if (polling || !probes.length || process.platform === "win32") return;
		polling = true;
		execFile("ps", ["-axo", "pid=,etime=,pcpu=,args="], { maxBuffer: 8_000_000, timeout: 3000 }, (error, stdout) => {
			polling = false;
			if (error) return;
			for (const deadline of probes) live.set(deadline.key, parsePs(stdout, deadline.probe!, process.pid));
			tui?.requestRender();
		});
	};
	let pollTimer: ReturnType<typeof setInterval> | undefined;

	const sync = () => {
		const wanted = [...active.values()].some((deadline) => deadline.probe?.length);
		if (wanted && !pollTimer) {
			pollTimer = setInterval(poll, 2000);
			pollTimer.unref?.();
			poll();
		} else if (!wanted && pollTimer) {
			clearInterval(pollTimer);
			pollTimer = undefined;
			live.clear();
		}
		if (active.size && !timer) {
			timer = setInterval(() => tui?.requestRender(), 500);
			timer.unref?.();
		} else if (!active.size && timer) {
			clearInterval(timer);
			timer = undefined;
		}
		tui?.requestRender();
	};
	const clearPrefix = (prefix: string) => {
		for (const key of [...active.keys()]) if (key.startsWith(prefix)) active.delete(key);
	};

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			const palette = (await import("../pi-ui/src/palette.ts")) as { usePalette(name: string | undefined): boolean; C: Colors };
			palette.usePalette(ctx.ui.theme?.name);
			useColors(palette.C);
		} catch {}
		ctx.ui.setWidget(
			"timeout-bar",
			(widgetTui) => {
				tui = widgetTui;
				return { render: (width: number) => [...active.values()].flatMap((deadline) => [renderDeadline(deadline, width, Date.now()), ...(deadline.watch ? watchLines(deadline.watch, width, Date.now()) : []), ...(deadline.probe ? liveLines(live.get(deadline.key), width) : [])]), invalidate() {} };
			},
			{ placement: "aboveEditor" },
		);
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const input = event.input as { command?: unknown; timeout?: unknown };
		const id = String(event.toolCallId);
		const command = String(input.command ?? "");
		const now = Date.now();
		const seconds = Number(input.timeout);
		if (Number.isFinite(seconds) && seconds > 0) active.set(`${id}:bash`, { key: `${id}:bash`, label: "bash timeout", startedAt: now, timeoutMs: seconds * 1000 });
		shellTimeouts(command).forEach((entry, index) => active.set(`${id}:sh${index}`, { key: `${id}:sh${index}`, label: `timeout ${entry.text.split(/\s+/).slice(0, 3).join(" ")}`.trim(), startedAt: now, timeoutMs: entry.ms }));
		const sleepMs = shellSleepMs(command);
		if (sleepMs >= 1000) active.set(`${id}:sleep`, { key: `${id}:sleep`, label: "sleep", startedAt: now, timeoutMs: sleepMs, watch: watchedFile(command, ctx.cwd), probe: probeTokens(command) });
		sync();
		return undefined;
	});
	pi.on("tool_result", (event) => {
		clearPrefix(`${String(event.toolCallId)}:`);
		sync();
	});

	// Other extensions (pi-team) report their own deadlines.
	pi.events.on("timeout-bar:set", (data) => {
		const deadline = data as Deadline;
		if (deadline?.key && deadline.timeoutMs > 0) active.set(deadline.key, deadline);
		sync();
	});
	pi.events.on("timeout-bar:clear", (data) => {
		const key = (data as { key?: string; prefix?: string } | undefined);
		if (key?.key) active.delete(key.key);
		if (key?.prefix) clearPrefix(key.prefix);
		sync();
	});

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		if (pollTimer) clearInterval(pollTimer);
		timer = pollTimer = undefined;
		active.clear();
	});
}
