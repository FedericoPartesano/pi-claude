/**
 * Progress bars for the timeouts running right now, in a panel above the editor: the bash tool's own `timeout`
 * argument, a `timeout N cmd` inside the command, the total of the `sleep N` calls in the command, and the team agents (pi-team, which reports them on the
 * `timeout-bar:set` / `timeout-bar:clear` events). Nothing is rewritten and nothing is added to the prompt.
 * The bridge's MCP_TOOL_TIMEOUT is 24 h on purpose, so it gets no bar. PI_TIMEOUT_BAR=0 turns it off.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { barCells } from "./test-monitor/views.ts";
import { C, type Colors, duration, fg, truncateToWidth, useColors } from "./test-monitor/render.ts";

export interface Deadline {
	key: string;
	label: string;
	startedAt: number;
	timeoutMs: number;
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

	const sync = () => {
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
				return { render: (width: number) => [...active.values()].map((deadline) => renderDeadline(deadline, width, Date.now())), invalidate() {} };
			},
			{ placement: "aboveEditor" },
		);
	});

	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return undefined;
		const input = event.input as { command?: unknown; timeout?: unknown };
		const id = String(event.toolCallId);
		const command = String(input.command ?? "");
		const now = Date.now();
		const seconds = Number(input.timeout);
		if (Number.isFinite(seconds) && seconds > 0) active.set(`${id}:bash`, { key: `${id}:bash`, label: "bash timeout", startedAt: now, timeoutMs: seconds * 1000 });
		shellTimeouts(command).forEach((entry, index) => active.set(`${id}:sh${index}`, { key: `${id}:sh${index}`, label: `timeout ${entry.text.split(/\s+/).slice(0, 3).join(" ")}`.trim(), startedAt: now, timeoutMs: entry.ms }));
		const sleepMs = shellSleepMs(command);
		if (sleepMs >= 1000) active.set(`${id}:sleep`, { key: `${id}:sleep`, label: "sleep", startedAt: now, timeoutMs: sleepMs });
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
		timer = undefined;
		active.clear();
	});
}
