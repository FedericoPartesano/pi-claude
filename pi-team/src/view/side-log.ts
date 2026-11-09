/**
 * The team's live log as a column of Pi's layout (or, where there is none, a strip above the editor): one block per
 * agent, newest lines at the bottom, the running agents sharing the height. It opens by itself when an agent starts and
 * closes a while after the last one ends, so it is always visible when the team works and gone when it does not.
 * Pure rendering lives in `renderTeamLog`; `TeamLog` owns the open/close timing. pi-ui's SideColumn is found through a
 * global symbol (the packages do not import each other).
 */
import type { AgentFeed, AgentActivity } from "../feed.ts";
import { elapsed, entryLines, stateColor, stateIcon } from "./agent-card.ts";
import { fit, formatDuration, formatTokens, spread, type ViewTheme } from "./widgets.ts";

/** No event from a running agent for this long: shown as stalled. */
export const STALL_SECONDS = 45;

export function renderTeamLog(theme: ViewTheme, agents: readonly AgentActivity[], width: number, height: number, now: number, frame: number): string[] {
	const running = agents.filter((agent) => agent.state === "running");
	const head = spread(
		`${theme.bold(theme.fg(running.length ? "accent" : "muted", "TEAM"))} ${theme.fg("dim", running.length ? `${running.length} al lavoro · ${agents.length - running.length} finiti` : `${agents.length} finiti`)}`,
		width >= 48 ? theme.fg("dim", "ctrl+alt+a dettaglio") : "",
		width,
	);
	if (agents.length === 0) return [head, theme.fg("dim", "nessun agente")].map((line) => fit(line, width));
	const lines: string[] = [head];
	const finished = agents.filter((agent) => agent.state !== "running");
	// Finished agents get one line each (most recent last), the running ones split what is left.
	const shownFinished = finished.slice(-Math.max(0, Math.min(finished.length, Math.floor(height / 4))));
	const room = Math.max(0, height - 1 - shownFinished.length - running.length * 2);
	const share = running.length ? Math.max(1, Math.floor(room / running.length)) : 0;
	const blockHeader = (agent: AgentActivity) => {
		const idle = Math.floor((now - agent.lastActivity) / 1000);
		const stalled = agent.state === "running" && idle >= STALL_SECONDS;
		const right = stalled ? theme.fg("warning", `fermo da ${formatDuration(idle)}`) : theme.fg("dim", `${formatDuration(elapsed(agent, now))} · ${formatTokens(agent.inputTokens + agent.outputTokens)}`);
		return spread(`${stateIcon(theme, agent, frame)} ${theme.bold(theme.fg(stateColor(agent), agent.id))} ${theme.fg("muted", agent.role)}`, right, width);
	};
	for (const agent of shownFinished) lines.push(blockHeader(agent));
	for (const agent of running) {
		lines.push(blockHeader(agent));
		const timeline = agent.entries.flatMap((entry) => entryLines(theme, entry, width - 1, false));
		const tail = timeline.slice(-share);
		const body = tail.length ? tail : [theme.fg("dim", "in avvio…")];
		for (const line of body.slice(-Math.max(1, share))) lines.push(` ${line}`);
	}
	return lines.slice(0, Math.max(2, height)).map((line) => fit(line, width));
}

type SideColumnApi = { available(): boolean; open(component: unknown, options?: { width?: number; onClose?: () => void }): void; close(): void; isOpen(): boolean; redraw(): void };
const sideColumn = (): SideColumnApi | undefined => (globalThis as unknown as Record<symbol, SideColumnApi | undefined>)[Symbol.for("pi-claude/side-column")];

export interface TeamLogUi {
	theme: ViewTheme;
	setWidget(key: string, content: unknown, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
}

export const COLUMN_WIDTH = 60;
/** Panel width of the RPC chat; the text widget is rendered for it. */
export const TEXT_WIDTH = 33;
/** RPC hosts only get plain string lines: the clock only has to move the "stalled" label, so it ticks slowly. */
export const TEXT_TICK_MS = 5_000;
const ROLE_COLOR: Record<string, string> = { accent: "38;2;255;63;216", success: "38;2;61;242;160", error: "38;2;255;77;109", warning: "38;2;245;185;66", muted: "38;2;133;139;160", dim: "38;2;133;139;160", text: "38;2;220;223;232" };
/** Minimal ANSI theme for hosts that do not hand one over (RPC). */
export const ansiTheme: ViewTheme = {
	fg: (role, text) => `\x1b[${ROLE_COLOR[role] ?? ROLE_COLOR.text}m${text}\x1b[39m`,
	bg: (_role, text) => text,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	italic: (text) => `\x1b[3m${text}\x1b[23m`,
};
/** How long the log stays after the last agent ends. */
export const LINGER_MS = 15_000;

export class TeamLog {
	private frame = 0;
	private timer?: ReturnType<typeof setInterval>;
	private closeTimer?: ReturnType<typeof setTimeout>;
	private mode: "none" | "column" | "strip" | "text" = "none";
	private textOnly = false;
	private lastText = "";
	private ui?: TeamLogUi;
	private requestRender?: () => void;
	/** Set by the user with /team-log: the log stays closed even while agents run. */
	hidden = false;
	private readonly feed: AgentFeed;
	private readonly rows: () => number;
	private readonly now: () => number;
	private readonly unsubscribe: () => void;

	constructor(feed: AgentFeed, rows: () => number = () => process.stdout.rows || 30, now: () => number = Date.now) {
		this.feed = feed;
		this.rows = rows;
		this.now = now;
		this.unsubscribe = feed.subscribe(() => this.update());
	}

	/** The newest UI to draw on; call at the start of each run (a context captured before a reload is stale). */
	attach(ui: TeamLogUi | undefined, mode?: string): void {
		this.ui = ui;
		this.textOnly = mode !== undefined && mode !== "tui";
		this.update();
	}

	private component = {
		render: (width: number) => renderTeamLog(this.ui!.theme, this.feed.agents, width, Math.max(6, this.rows() - 2), this.now(), this.frame),
		invalidate() {},
	};

	private update(): void {
		const active = this.feed.running > 0;
		if (active) {
			clearTimeout(this.closeTimer);
			this.closeTimer = undefined;
			if (this.mode === "none" && this.ui && !this.hidden) this.open();
		} else if (this.mode !== "none" && !this.closeTimer) {
			this.closeTimer = setTimeout(() => this.close(), LINGER_MS);
			this.closeTimer.unref?.();
		}
		if (this.mode === "column") sideColumn()?.redraw();
		else if (this.mode === "text") this.pushText();
		this.requestRender?.();
	}

	/** RPC: send the log as a string-array widget, only when it changed. */
	private pushText(): void {
		const lines = renderTeamLog(ansiTheme, this.feed.agents, TEXT_WIDTH, Math.min(16, Math.max(4, this.feed.agents.length * 3 + 2)), this.now(), 0);
		const text = lines.join("\n");
		if (text === this.lastText) return;
		this.lastText = text;
		this.ui?.setWidget("team-log", lines);
	}

	open(): void {
		if (!this.ui || this.mode !== "none") return;
		if (this.textOnly) {
			this.mode = "text";
			this.pushText();
			this.timer = setInterval(() => this.update(), TEXT_TICK_MS);
			this.timer.unref?.();
			return;
		}
		const column = sideColumn();
		if (column?.available() && !column.isOpen()) {
			column.open(this.component, { width: COLUMN_WIDTH, onClose: () => { if (this.mode === "column") this.stop(); } });
			this.mode = "column";
		} else {
			this.ui.setWidget(
				"team-log",
				(tui: { requestRender(): void }) => {
					this.requestRender = () => tui.requestRender();
					return { render: (width: number) => renderTeamLog(this.ui!.theme, this.feed.agents, width, Math.min(14, Math.max(4, this.feed.agents.length * 2 + 2)), this.now(), this.frame), invalidate() {} };
				},
				{ placement: "aboveEditor" },
			);
			this.mode = "strip";
		}
		// Spinners and the "stalled" clock move even when no event arrives.
		this.timer = setInterval(() => {
			this.frame++;
			this.update();
		}, 400);
		this.timer.unref?.();
	}

	private stop(): void {
		this.mode = "none";
		clearInterval(this.timer);
		clearTimeout(this.closeTimer);
		this.timer = undefined;
		this.closeTimer = undefined;
		this.requestRender = undefined;
		this.lastText = "";
	}

	close(): void {
		const was = this.mode;
		if (was === "none") return;
		this.stop();
		if (was === "column") sideColumn()?.close();
		else this.ui?.setWidget("team-log", undefined); // strip or text
	}

	toggle(): boolean {
		this.hidden = this.mode !== "none";
		if (this.hidden) this.close();
		else if (this.feed.agents.length) this.open();
		return !this.hidden;
	}

	dispose(): void {
		this.close();
		this.unsubscribe();
	}
}
