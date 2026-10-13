/**
 * tab-status: the terminal tab title shows at a glance whether Pi is working or waiting for you.
 * Working: a small spinner that turns (one redraw every 500 ms, nothing else). Waiting: a green dot.
 * Zero tokens, no tool. PI_TAB_STATUS=0 turns it off.
 */
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const IDLE = "🟢";

export function tabTitle(icon: string, cwd: string, session?: string): string {
	const name = session?.trim();
	return `${icon} π - ${name ? `${name} - ` : ""}${basename(cwd) || cwd}`;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_TAB_STATUS === "0") return;
	let timer: ReturnType<typeof setInterval> | undefined;
	let frame = 0;
	let current: ExtensionContext | undefined;

	const set = (icon: string) => {
		try {
			if (current?.hasUI) current.ui.setTitle(tabTitle(icon, current.cwd, current.sessionManager?.getSessionName?.()));
		} catch {
			current = undefined; // stale context after a reload or session change: stop touching it
			stop();
		}
	};
	const stop = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		stop();
		current = ctx;
		set(IDLE);
	});
	pi.on("agent_start", (_event, ctx) => {
		current = ctx;
		stop();
		set(FRAMES[0]);
		timer = setInterval(() => set(FRAMES[++frame % FRAMES.length]), 500);
		timer.unref?.();
	});
	pi.on("agent_end", () => {
		stop();
		set(IDLE);
	});
	pi.on("session_shutdown", () => {
		stop();
		current = undefined;
	});
}
