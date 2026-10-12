/**
 * /agents (Ctrl+Alt+A): every agent of the running team or `parallel` call, live, in an overlay over the chat.
 *
 * Layout, top to bottom:
 * - header: title, counts by state, total time and tokens, the keys;
 * - roster: one tab per agent (spinner / ✓ / ✗), the selected one highlighted, ‹ › when they do not fit;
 * - grid: one card per agent (see agent-card.ts), as many columns as fit, a second row when there is room;
 * - zoom (Enter): the selected card full height with complete output and a scrollbar, next to a stats panel
 *   (tools used, context growth per request, time, cost).
 *
 * Keys: ←/→ (or h/l) agent · ↑/↓ row in the grid, scroll in the zoom · PgUp/PgDn · End follows the tail ·
 * Enter zoom · f only active ones · Esc leaves the zoom, then closes.
 */
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { AgentActivity, AgentFeed } from "../feed.ts";
import { elapsed, renderAgentCard, stateIcon } from "./agent-card.ts";
import { chip, fit, formatDuration, formatTokens, frame, keycap, pad, sparkline, spread, type ViewTheme } from "./widgets.ts";

/** Narrowest readable card; fewer columns fit, the rest is paged with the selection. */
export const MIN_CARD_WIDTH = 38;
/** Shortest card worth a second grid row. */
const MIN_CARD_HEIGHT = 14;
const STATS_WIDTH = 34;

/** Running agents first (in start order), then the finished ones, most recent first. */
export function orderAgents(agents: AgentActivity[]): AgentActivity[] {
	const running = agents.filter((agent) => agent.state === "running");
	const finished = agents.filter((agent) => agent.state !== "running").reverse();
	return [...running, ...finished];
}

export interface GridLayout {
	columns: number;
	rows: number;
	cardWidth: number;
	cardHeight: number;
}

/** How many cards fit in `width` × `height`, and their size. */
export function gridLayout(count: number, width: number, height: number): GridLayout {
	const fitColumns = Math.max(1, Math.floor((width + 1) / (MIN_CARD_WIDTH + 1)));
	const columns = Math.max(1, Math.min(count, fitColumns));
	const fitRows = Math.max(1, Math.floor(height / MIN_CARD_HEIGHT));
	const rows = Math.max(1, Math.min(fitRows, Math.ceil(count / columns)));
	return { columns, rows, cardWidth: Math.floor((width - (columns - 1)) / columns), cardHeight: Math.floor(height / rows) };
}

export class AgentsView implements Component {
	private selectedKey?: string;
	private page = 0;
	private zoomed = false;
	private scroll = 0;
	private onlyActive = false;
	private frame = 0;
	private readonly timer: ReturnType<typeof setInterval>;
	private readonly unsubscribe: () => void;

	private readonly feed: AgentFeed;
	private readonly theme: ViewTheme;
	private readonly done: () => void;
	private readonly requestRender: () => void;
	private readonly rows: () => number;
	private readonly now: () => number;

	constructor(feed: AgentFeed, theme: ViewTheme, done: () => void, requestRender: () => void, rows: () => number, now: () => number = Date.now) {
		this.feed = feed;
		this.theme = theme;
		this.done = done;
		this.requestRender = requestRender;
		this.rows = rows;
		this.now = now;
		this.unsubscribe = feed.subscribe(() => this.requestRender());
		// Spinners and clocks move even when no event arrives.
		this.timer = setInterval(() => {
			this.frame++;
			if (this.feed.running > 0) this.requestRender();
		}, 120);
		this.timer.unref?.();
	}

	private agents(): AgentActivity[] {
		const ordered = orderAgents(this.feed.agents);
		const shown = this.onlyActive ? ordered.filter((agent) => agent.state === "running") : ordered;
		return shown.length ? shown : ordered;
	}

	/** Index of the selected agent; the selection follows the agent, not the position, as the order changes. */
	private selectedIndex(agents: AgentActivity[]): number {
		const index = agents.findIndex((agent) => agent.key === this.selectedKey);
		if (index >= 0) return index;
		this.selectedKey = agents[0]?.key;
		return 0;
	}

	private select(agents: AgentActivity[], index: number) {
		const clamped = Math.max(0, Math.min(agents.length - 1, index));
		if (agents[clamped]?.key !== this.selectedKey) this.scroll = 0;
		this.selectedKey = agents[clamped]?.key;
	}

	/** Columns of the last grid drawn, for ↑/↓. */
	private lastColumns = 1;

	handleInput(data: string): void {
		const agents = this.agents();
		const index = this.selectedIndex(agents);
		const page = Math.max(1, this.rows() - 12);
		if (matchesKey(data, "escape") || data === "q") {
			if (this.zoomed) this.zoomed = false;
			else return this.done();
		} else if (matchesKey(data, "left") || data === "h") this.select(agents, index - 1);
		else if (matchesKey(data, "right") || data === "l") this.select(agents, index + 1);
		else if (matchesKey(data, "enter")) {
			this.zoomed = !this.zoomed;
			this.scroll = 0;
		} else if (data === "f") this.onlyActive = !this.onlyActive;
		else if (matchesKey(data, "up") || data === "k") {
			if (this.zoomed) this.scroll++;
			else this.select(agents, index - this.lastColumns);
		} else if (matchesKey(data, "down") || data === "j") {
			if (this.zoomed) this.scroll = Math.max(0, this.scroll - 1);
			else this.select(agents, index + this.lastColumns);
		} else if (matchesKey(data, "pageUp")) this.scroll += page;
		else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, this.scroll - page);
		else if (matchesKey(data, "end")) this.scroll = 0;
		else return;
		this.requestRender();
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
		this.unsubscribe();
	}

	render(width: number): string[] {
		const { theme } = this;
		const now = this.now();
		const height = Math.max(16, this.rows());
		const all = this.feed.agents;
		const agents = this.agents();
		const selected = this.selectedIndex(agents);
		const inner = width - 2;
		const content = inner - 2;

		// Header: identity and totals on the left, keys on the right.
		const running = all.filter((agent) => agent.state === "running").length;
		const failed = all.filter((agent) => agent.state === "failed").length;
		const done = all.length - running - failed;
		const startedAt = Math.min(...all.map((agent) => agent.startedAt), now);
		const endedAt = running ? now : Math.max(...all.map((agent) => agent.startedAt + elapsed(agent, now) * 1000), startedAt);
		const totalIn = all.reduce((sum, agent) => sum + agent.inputTokens, 0);
		const totalOut = all.reduce((sum, agent) => sum + agent.outputTokens, 0);
		const counts = [
			running ? theme.fg("accent", `● ${running} al lavoro`) : "",
			done ? theme.fg("success", `✓ ${done} finiti`) : "",
			failed ? theme.fg("error", `✗ ${failed} falliti`) : "",
		].filter(Boolean).join(theme.fg("dim", " · "));
		const totals = theme.fg("muted", `${formatDuration((endedAt - startedAt) / 1000)} · ↑${formatTokens(totalIn)} ↓${formatTokens(totalOut)}`);
		const badge = chip(theme, "◆ AGENTI", "accent", true);
		const header = spread(`${badge} ${counts || theme.fg("muted", "nessuno")}  ${totals}`, this.onlyActive ? chip(theme, "solo attivi", "warning", true) : "", content);

		// Roster: a tab per agent, then a bar with one segment per agent, colored by state.
		const tabs = agents.map((agent, index) => {
			const label = `${stateIcon(theme, agent, this.frame)} ${agent.id}`;
			return index === selected ? theme.bg("selectedBg", theme.bold(` ${label} `)) : ` ${label} `;
		});
		const roster = fitTabs(tabs, selected, content, theme);

		const keys = (this.zoomed
			? [keycap(theme, "↑↓", "scorri"), keycap(theme, "End", "segui"), keycap(theme, "←→", "agente"), keycap(theme, "esc", "colonne")]
			: [keycap(theme, "←→↑↓", "scegli"), keycap(theme, "invio", "dettaglio"), keycap(theme, "f", this.onlyActive ? "tutti" : "solo attivi"), keycap(theme, "esc", "chiudi")]
		).join("  ");

		const bodyHeight = height - 6;
		let body: string[];
		if (agents.length === 0) {
			body = emptyState(theme, content, bodyHeight);
		} else if (this.zoomed) {
			const agent = agents[selected]!;
			const statsWidth = content >= 100 ? STATS_WIDTH : 0;
			const cardWidth = content - (statsWidth ? statsWidth + 1 : 0);
			const card = renderAgentCard(theme, agent, cardWidth, bodyHeight, { selected: true, scroll: this.scroll, frame: this.frame, now, detailed: true });
			const stats = statsWidth ? statsPanel(theme, agent, statsWidth, bodyHeight, now) : [];
			body = card.map((line, row) => (statsWidth ? `${line} ${stats[row] ?? ""}` : line));
		} else {
			const layout = gridLayout(agents.length, content, bodyHeight);
			this.lastColumns = layout.columns;
			const perPage = layout.columns * layout.rows;
			this.page = Math.floor(selected / perPage);
			const shown = agents.slice(this.page * perPage, this.page * perPage + perPage);
			body = [];
			for (let gridRow = 0; gridRow < layout.rows; gridRow++) {
				// The leftover columns go to the first cards, so the row fills the width.
				const spare = content - (layout.cardWidth * layout.columns + layout.columns - 1);
				const cards = shown.slice(gridRow * layout.columns, (gridRow + 1) * layout.columns).map((agent, column) =>
					renderAgentCard(theme, agent, layout.cardWidth + (column < spare ? 1 : 0), layout.cardHeight, { selected: agent.key === this.selectedKey, scroll: 0, frame: this.frame, now, detailed: false }),
				);
				for (let line = 0; line < layout.cardHeight; line++) body.push(cards.map((card) => card[line] ?? "").join(" "));
			}
			const pages = Math.ceil(agents.length / perPage);
			while (body.length < bodyHeight) body.push("");
			if (pages > 1) roster.push(theme.fg("dim", `pagina ${this.page + 1}/${pages}`));
		}

		const lines = [header, roster[0] ?? "", theme.fg("borderMuted", "─".repeat(content)), ...body, spread(keys, theme.fg("dim", roster[1] ?? ""), content)];
		return frame(theme, lines, width, height, { title: theme.bold(theme.fg("accent", "pi-team")), badge: theme.fg("dim", "/agents · ctrl+alt+a"), color: "borderAccent" }).map((line) => truncateToWidth(line, width));
	}
}

/** The tabs that fit around the selected one, with ‹ › when some are hidden. Returns [line, extra info]. */
function fitTabs(tabs: string[], selected: number, width: number, theme: ViewTheme): string[] {
	let start = selected;
	let end = selected + 1;
	const widthOf = (from: number, to: number) => tabs.slice(from, to).reduce((sum, tab) => sum + visibleWidth(tab), 0) + 4;
	while (true) {
		const grown = end < tabs.length && widthOf(start, end + 1) <= width ? [start, end + 1] : start > 0 && widthOf(start - 1, end) <= width ? [start - 1, end] : undefined;
		if (!grown) break;
		[start, end] = grown as [number, number];
	}
	const left = start > 0 ? theme.fg("dim", "‹ ") : "  ";
	const right = end < tabs.length ? theme.fg("dim", " ›") : "";
	return [fit(`${left}${tabs.slice(start, end).join("")}${right}`, width)];
}

function emptyState(theme: ViewTheme, width: number, height: number): string[] {
	const message = [
		theme.bold(theme.fg("text", "Nessun agente al lavoro")),
		"",
		theme.fg("muted", "Le colonne si riempiono quando partono il team (`/team`, tool `team`)"),
		theme.fg("muted", "o il tool `parallel`: puoi lasciare aperta questa vista."),
	];
	const top = Math.max(0, Math.floor((height - message.length) / 2));
	const lines = Array.from({ length: height }, () => "");
	message.forEach((line, index) => {
		const left = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
		lines[top + index] = pad(" ".repeat(left) + line, width);
	});
	return lines;
}

/** Zoom side panel: tools by use, context per request, time and tokens. */
function statsPanel(theme: ViewTheme, agent: AgentActivity, width: number, height: number, now: number): string[] {
	const content = width - 4;
	const label = (text: string) => theme.bold(theme.fg("muted", text.toUpperCase()));
	const tools = Object.entries(agent.toolCounts).sort((a, b) => b[1] - a[1]);
	const most = Math.max(1, ...tools.map(([, count]) => count));
	const nameWidth = Math.min(12, Math.max(4, ...tools.map(([name]) => name.length)));
	const barRoom = Math.max(4, content - nameWidth - 5);
	const toolRows = tools.length
		? tools.slice(0, 8).map(([name, count]) => `${theme.fg("toolTitle", fit(name, nameWidth))} ${theme.fg("accent", "█".repeat(Math.max(1, Math.round((count / most) * barRoom))))} ${theme.fg("muted", String(count))}`)
		: [theme.fg("dim", "nessuno")];
	const contextRows = agent.requestTokens.length
		? [theme.fg("accent", sparkline(agent.requestTokens, content)), theme.fg("dim", spread(`1ª ${formatTokens(agent.requestTokens[0]!)}`, `ultima ${formatTokens(agent.requestTokens.at(-1)!)}`, content))]
		: [theme.fg("dim", "nessuna richiesta finora")];
	const seconds = elapsed(agent, now);
	const lines = [
		label("strumenti"),
		...toolRows,
		"",
		label("contesto per richiesta"),
		...contextRows,
		"",
		label("costo"),
		spread(theme.fg("muted", "tempo"), theme.fg("text", formatDuration(seconds)), content),
		spread(theme.fg("muted", "richieste"), theme.fg("text", String(agent.requests)), content),
		spread(theme.fg("muted", "token in"), theme.fg("text", formatTokens(agent.inputTokens)), content),
		spread(theme.fg("muted", "token out"), theme.fg("text", formatTokens(agent.outputTokens)), content),
		spread(theme.fg("muted", "modello"), theme.fg("text", agent.model), content),
		agent.attempt > 1 ? spread(theme.fg("muted", "tentativo"), theme.fg("warning", String(agent.attempt)), content) : "",
	].filter((line, index, all) => line !== "" || all[index - 1] !== "");
	return frame(theme, lines, width, height, { title: theme.fg("muted", "statistiche"), color: "borderMuted" });
}
