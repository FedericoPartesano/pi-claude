/**
 * One agent as a card: who it is and what it costs at the top, its activity as a timeline (thinking, tool
 * calls with their output, answers), what it is doing now pinned at the bottom.
 */
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AgentActivity, FeedEntry } from "../feed.ts";
import { formatDuration, formatTokens, frame, scrollbar, spread, SPINNER, type Fg, type ViewTheme } from "./widgets.ts";

export interface CardState {
	selected: boolean;
	/** Lines scrolled up from the newest activity (0 = follow the tail). */
	scroll: number;
	frame: number;
	now: number;
	/** Zoomed card: full results, a scrollbar. */
	detailed: boolean;
}

export function stateColor(agent: AgentActivity): Fg {
	return agent.state === "running" ? "accent" : agent.state === "done" ? "success" : "error";
}

export function stateIcon(theme: ViewTheme, agent: AgentActivity, frameIndex: number): string {
	if (agent.state === "running") return theme.fg("accent", SPINNER[frameIndex % SPINNER.length]!);
	return agent.state === "done" ? theme.fg("success", "✓") : theme.fg("error", "✗");
}

export function elapsed(agent: AgentActivity, now: number): number {
	return agent.seconds ?? (now - agent.startedAt) / 1000;
}

/** Timeline lines of one entry, with a gutter mark: ┊ thinking, ▸ tool, ⎿ output, › answer, ✗ error. */
export function entryLines(theme: ViewTheme, entry: FeedEntry, width: number, detailed: boolean): string[] {
	const wrap = (text: string, room: number) => wrapTextWithAnsi(text, Math.max(6, room));
	const gutter = (mark: string, role: Fg, lines: string[]) => lines.map((line, index) => `${index === 0 ? theme.fg(role, mark) : " "} ${line}`);
	const text = entry.text.trim();
	switch (entry.kind) {
		case "thinking": {
			if (!text) return [];
			const lines = wrap(text, width - 2);
			const shown = detailed ? lines : lines.slice(-6);
			const cut = lines.length > shown.length ? [theme.fg("dim", "…")] : [];
			return gutter("┊", "thinkingText", [...cut, ...shown.map((line) => theme.italic(theme.fg("thinkingText", line)))]);
		}
		case "text":
			return text ? gutter("›", "text", wrap(text, width - 2).map((line) => theme.fg("text", line))) : [];
		case "tool": {
			const title = `${theme.bold(theme.fg("toolTitle", entry.tool ?? "tool"))}${text ? ` ${theme.fg("mdCode", text)}` : ""}`;
			const lines = wrap(title, width - 2);
			return gutter("▸", "accent", detailed ? lines : lines.slice(0, 2));
		}
		case "result": {
			const raw = text.split("\n").filter((line) => line.trim());
			const limit = detailed ? 40 : 3;
			const shown = raw.slice(0, limit).flatMap((line) => wrap(line, width - 4).slice(0, detailed ? 4 : 1));
			const more = raw.length > limit ? [theme.fg("dim", `+${raw.length - limit} righe`)] : [];
			const role: Fg = entry.failed ? "error" : "toolOutput";
			return [...shown.map((line, index) => `  ${index === 0 ? theme.fg(entry.failed ? "error" : "dim", "⎿") : " "} ${theme.fg(role, line)}`), ...more.map((line) => `    ${line}`)];
		}
		case "error":
			return gutter("✗", "error", wrap(text, width - 2).map((line) => theme.fg("error", line)));
	}
}

/** The card, exactly `width` × `height`. */
export function renderAgentCard(theme: ViewTheme, agent: AgentActivity, width: number, height: number, state: CardState): string[] {
	const content = Math.max(6, width - 4);
	const seconds = elapsed(agent, state.now);
	const color: Fg = state.selected ? "borderAccent" : agent.state === "failed" ? "error" : agent.state === "done" ? "borderMuted" : "border";
	const title = `${stateIcon(theme, agent, state.frame)} ${theme.bold(theme.fg(state.selected ? "accent" : "text", agent.id))} ${theme.fg("muted", agent.role)}`;
	const badge = agent.attempt > 1 ? theme.fg("warning", `tentativo ${agent.attempt}`) : theme.fg("dim", formatDuration(seconds));

	const header = [
		theme.bold(theme.fg("text", truncateToWidth(agent.title, content))),
		spread(theme.fg("dim", agent.model), theme.fg("muted", `↑${formatTokens(agent.inputTokens)} ↓${formatTokens(agent.outputTokens)} · ${agent.requests} rich.`), content),
		theme.fg("borderMuted", "┄".repeat(content)),
	];
	const status = agent.currentTool
		? spread(`${theme.fg("warning", SPINNER[state.frame % SPINNER.length]!)} ${theme.fg("warning", agent.currentTool)}`, theme.fg("dim", formatDuration((state.now - (agent.toolSince ?? state.now)) / 1000)), content)
		: agent.state === "running"
			? `${theme.fg("accent", SPINNER[state.frame % SPINNER.length]!)} ${theme.fg("muted", "ragiona…")}`
			: agent.state === "done"
				? theme.fg("success", `✓ finito in ${formatDuration(seconds)}`)
				: theme.fg("error", `✗ ${agent.error ?? "non riuscito"}`);

	const timeline = agent.entries.flatMap((entry, index) => {
		const lines = entryLines(theme, entry, content, state.detailed);
		// A blank line before each tool call groups it with its output.
		return entry.kind === "tool" && index > 0 ? ["", ...lines] : lines;
	});
	const room = Math.max(0, height - 2 - header.length - 1);
	const maxScroll = Math.max(0, timeline.length - room);
	const scroll = Math.min(state.scroll, maxScroll);
	const end = timeline.length - scroll;
	const visible = timeline.slice(Math.max(0, end - room), end);
	const empty = agent.entries.length === 0 ? [theme.fg("dim", "in avvio…")] : [];
	const body = [...header, ...empty, ...visible];
	while (body.length < header.length + room) body.push("");
	body.push(status);

	const thumb = state.detailed ? [...Array(header.length).fill(false), ...scrollbar(timeline.length, room, maxScroll - scroll, room), false] : undefined;
	const footer = state.detailed && scroll > 0 ? theme.fg("warning", `↑ ${scroll} righe sopra l'ultima · End per seguire`) : undefined;
	return frame(theme, body, width, height, { title, badge, color, thumb, footer });
}
