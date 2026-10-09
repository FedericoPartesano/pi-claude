/**
 * The session panel (Alt+S by default, Neon Night principle 5): goal/loop/team, changed files, failing tests, the last image and
 * usage. Drawn as an overlay on the right that never takes the keyboard.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "./status-bar.ts";
import { formatDuration } from "./steps.ts";
import { renderAgents, type AgentRow } from "./agents.ts";
import { I, withIcon, type IconName } from "./icons.ts";
import { C, bg, bold, fg, fit, hud, pad, underline } from "./palette.ts";

export interface ChangedFile {
	status: string;
	path: string;
	added?: number;
	removed?: number;
}

export interface PanelInfo {
	/** setStatus texts of goal, loop and team. */
	session: ReadonlyMap<string, string>;
	files: ChangedFile[];
	failures: string[];
	image?: { ref: string; lines: string[] };
	usage: { fiveHour?: number; sevenDay?: number; contextPercent?: number; contextTokens?: number; contextWindow?: number; model: string; thinking: string };
	/** The current or last turn. */
	turn?: { mode: "working" | "waiting" | "stopped" | "done" | "ready"; steps: number; seconds: number; tokensIn: number; tokensOut: number };
	/** Latest steps, oldest first. */
	activity?: { time: string; icon: string; ok: boolean; text: string }[];
	git?: { branch?: string; ahead: number; behind: number; lastCommit?: string };
	/** setStatus("memory") of the memory extension. */
	memory?: string;
	suggestions?: string[];
	/** Sub-agents of the subagent and team tools. */
	agents?: AgentRow[];
	/** Clock for the agents' running time (default: now). */
	now?: number;
	/** The todo tool's plan (rpiv-todo), in its order. */
	plan?: { subject: string; status: string }[];
	/** The in-progress intent of the project. */
	intent?: { file: string; title: string; outcomes: string[] };
	/** Tokens saved by lean-tools in this session (estimated). */
	saved?: number;
	/** The running goal (extensions/goal.ts, pi.events "goal:state"). */
	goal?: {
		state: "attivo" | "in pausa";
		text: string;
		intentFile?: string;
		pausedReason?: string;
		outcomes: { text: string; done: boolean }[];
		done: number;
		total: number;
		round: number;
		max: number;
		minutes: number;
		lastEvent?: string;
	};
}

/** `git rev-list --left-right --count @{upstream}...HEAD` → commits behind / ahead of the remote. */
export function parseAheadBehind(output: string): { behind: number; ahead: number } {
	const [behind, ahead] = output.trim().split(/\s+/).map(Number);
	return { behind: behind || 0, ahead: ahead || 0 };
}

export const PANEL_WIDTH = 40;

/** `git status --porcelain` → status letter (untracked counts as added) and path (renames: the new one). */
export function parsePorcelain(output: string): ChangedFile[] {
	return output
		.split("\n")
		.filter((line) => line.length > 3)
		.map((line) => {
			const code = line.slice(0, 2);
			const status = code === "??" ? "A" : (code.trim()[0] ?? "M");
			return { status, path: line.slice(3).split(" -> ").pop() ?? line.slice(3) };
		});
}

/** `git diff --numstat` → added/removed lines per path (binary files count 0). */
export function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	for (const line of output.split("\n")) {
		const [added, removed, path] = line.split("\t");
		if (path) counts.set(path, { added: Number(added) || 0, removed: Number(removed) || 0 });
	}
	return counts;
}

const bar = (fraction: number | undefined, cells = 10) => {
	const filled = Math.round(Math.min(1, Math.max(0, fraction ?? 0)) * cells);
	return fg(C.cyan, "▰".repeat(filled)) + fg(C.faint, "▱".repeat(cells - filled));
};

/** Default key of the panel: Alt+I and Alt+O are taken by komorebi/whkd, Ctrl+B by tmux. PI_UI_PANEL_KEY overrides it. */
export const PANEL_KEY = "alt+s";

export function renderPanel(info: PanelInfo, width: number, key = PANEL_KEY, maxLines = Number.MAX_SAFE_INTEGER): string[] {
	const inner = width - 2;
	// Sections with their icon; the HUD style numbers them: `// 01 SESSIONE`.
	let sections = 0;
	const ICONS: Record<string, IconName> = { SESSIONE: "session", TURNO: "turn", "SUB-AGENTI": "agent", "ATTIVITÀ": "activity", FILE: "files", TEST: "test", MEMORIA: "memory", SUGGERIMENTI: "suggest", GIT: "branch", IMMAGINI: "image", USO: "usage", PIANO: "todo", INTENT: "session", RISPARMIO: "usage", GOAL: "session" };
	const section = (title: string, right = "") => {
		sections++;
		const icon = I[ICONS[title] ?? "tool"];
		const name = withIcon(icon ? fg(C.mag, icon) : "", bold(fg(C.text, hud && title === "USO" ? "NET" : title)));
		const head = `${hud ? fg(C.faint, `// ${String(sections).padStart(2, "0")} `) : ""}${name} `;
		const tail = right ? ` ${right}` : "";
		return head + fg(C.border, "─".repeat(Math.max(1, inner - visibleWidth(head) - visibleWidth(tail)))) + tail;
	};
	// Blocks in display order; priority 0 always stays, higher numbers go first when the height is short.
	const blocks: { priority: number; render: () => string[] }[] = [];
	const add = (priority: number, render: () => string[]) => blocks.push({ priority, render });

	const title = hud ? `${fg(C.mag, "◢■")} ${bold(fg(C.mag, "SYS//PANNELLO"))}` : bold(fg(C.mag, "PANNELLO"));
	add(0, () => [fit(title, `${fg(C.text, key)} ${fg(C.dim, "chiudi")}`, inner)]);
	// The goal first: is it running, how far, what happened last.
	const goal = info.goal;
	add(0, () => {
		if (!goal) return [];
		const badge = goal.state === "attivo" ? fg(C.ok, "▶ attivo") : fg(C.warn, "⏸ in pausa");
		const rows = [section("GOAL", badge), bold(fg(C.text, goal.text || goal.intentFile || "goal"))];
		if (goal.state === "in pausa") rows.push(fg(C.warn, goal.pausedReason ?? "in pausa"), fg(C.dim, "/goal resume per riprendere"));
		const open = goal.outcomes.filter((outcome) => !outcome.done);
		// The open outcomes first (what is left), then the done ones while there is room.
		for (const outcome of [...open.slice(0, 6), ...goal.outcomes.filter((entry) => entry.done).slice(0, Math.max(0, 8 - Math.min(6, open.length)))]) {
			rows.push(`${outcome.done ? fg(C.ok, "✓") : fg(C.faint, "○")} ${fg(outcome.done ? C.dim : C.text, outcome.text)}`);
		}
		rows.push(fg(C.dim, `${goal.total ? `${goal.done}/${goal.total} · ` : ""}giro ${goal.round}/${goal.max} · ${goal.minutes} min`));
		if (goal.lastEvent) rows.push(fg(C.dim, goal.lastEvent));
		return [...rows, ""];
	});
	add(0, () => {
		const session = [
			["goal", "GOAL", C.mag],
			["loop", "LOOP", C.cyan],
			["team", "TEAM", C.yel],
		] as const;
		const rows = session.flatMap(([name, tag, color]) => {
			const text = info.session.get(name)?.replace(new RegExp(`^${name}\\s*`, "i"), "");
			return text ? [`${bold(fg(color, tag))} ${fg(C.text, text)}`] : [];
		});
		return [section("SESSIONE"), ...(rows.length ? rows : [fg(C.dim, "nessun goal, loop o team")])];
	});
	const turn = info.turn;
	const mode = turn?.mode;
	if (turn && mode && mode !== "ready") {
		add(2, () => {
			const mark = { working: fg(C.cyan, "⠋"), waiting: fg(C.yel, "◆"), stopped: fg(C.err, "✗"), done: fg(C.ok, "✓") }[mode];
			return ["", section("TURNO", mark), fg(C.text, `${turn.steps} passi · ${turn.seconds < 60 ? `${turn.seconds}s` : formatDuration(turn.seconds * 1000)} · ↑${formatTokens(turn.tokensIn)} ↓${formatTokens(turn.tokensOut)}`)];
		});
	}
	const plan = info.plan?.filter((task) => task.status !== "deleted") ?? [];
	if (plan.length) {
		add(1, () => {
			const done = plan.filter((task) => task.status === "completed").length;
			const mark = (task: { status: string }) => (task.status === "completed" ? fg(C.ok, "✓") : task.status === "in_progress" ? fg(C.cyan, "▸") : fg(C.faint, "○"));
			// In progress and pending first; the completed ones last, a few.
			const open = plan.filter((task) => task.status !== "completed");
			const shown = [...open.slice(0, 6), ...plan.filter((task) => task.status === "completed").slice(-Math.max(1, 7 - Math.min(6, open.length)))];
			const rows = shown.map((task) => `${mark(task)} ${fg(task.status === "in_progress" ? C.text : task.status === "completed" ? C.dim : C.text, task.subject)}`);
			if (plan.length > shown.length) rows.push(fg(C.dim, `… altri ${plan.length - shown.length}`));
			return ["", section("PIANO", fg(done === plan.length ? C.ok : C.cyan, `${done}/${plan.length}`)), ...rows];
		});
	}
	if (info.intent) {
		const intent = info.intent;
		add(2, () => ["", section("INTENT"), fg(C.text, intent.title), fg(C.dim, `${intent.outcomes.length} risultati attesi · ${intent.file.split("/").pop()}`)]);
	}
	if (info.agents?.length) {
		const agents = info.agents;
		add(1, () => {
			const active = agents.filter((agent) => agent.state === "running").length;
			return ["", section("SUB-AGENTI", fg(active ? C.cyan : C.dim, `${active} ${active === 1 ? "attivo" : "attivi"} / ${agents.length}`)), ...renderAgents(agents.slice(-6), inner, info.now ?? Date.now(), Math.floor((info.now ?? Date.now()) / 100))];
		});
	}
	if (info.failures.length) {
		add(1, () => ["", section("TEST", fg(C.err, `${info.failures.length} ✗`)), ...info.failures.slice(0, 4).map((failure) => `${fg(C.err, "✗")} ${fg(C.text, failure)}`)]);
	}
	if (info.activity?.length) {
		const activity = info.activity;
		add(3, () => ["", section("ATTIVITÀ"), ...activity.slice(-5).map((step) => `${fg(C.faint, step.time)} ${fg(step.ok ? C.ok : step.icon === "✗" ? C.err : C.cyan, step.icon)} ${fg(C.text, step.text)}`)]);
	}
	if (info.files.length) {
		add(3, () => {
			const rows = info.files.slice(0, 6).map((file) => {
				const color = file.status === "A" ? C.ok : file.status === "D" ? C.err : C.warn;
				const counts = `${file.added ? fg(C.add, `+${file.added}`) : ""}${file.removed ? ` ${fg(C.del, `-${file.removed}`)}` : ""}`.trim();
				return fit(`${fg(color, file.status)} ${fg(C.cyan, underline(file.path))}`, counts, inner);
			});
			if (info.files.length > 6) rows.push(fg(C.dim, `… altri ${info.files.length - 6}`));
			return ["", section("FILE", fg(C.yel, `✚${info.files.length}`)), ...rows];
		});
	}
	if (info.suggestions?.length) {
		const suggestions = info.suggestions;
		add(4, () => ["", section("SUGGERIMENTI"), ...suggestions.map((text, index) => `${fg(C.faint, "⟦")}${fg(C.mag, String(index + 1))}${fg(C.faint, "⟧")} ${fg(C.text, text)}`)]);
	}
	if (info.memory) {
		const memory = info.memory;
		add(5, () => ["", section("MEMORIA"), fg(C.text, memory), fit("", `${fg(C.mag, "/memory")} ${fg(C.dim, "apri")}`, inner)]);
	}
	const git = info.git;
	if (git?.branch) {
		const branch = git.branch;
		add(5, () => ["", section("GIT"), `${fg(C.cyan, withIcon(I.branch || "⎇", branch))}${git.ahead ? fg(C.ok, ` ↑${git.ahead}`) : ""}${git.behind ? fg(C.warn, ` ↓${git.behind}`) : ""}`, ...(git.lastCommit ? [fg(C.dim, git.lastCommit)] : [])]);
	}
	if (info.image) {
		const image = info.image;
		add(7, () => ["", section("IMMAGINI"), ...image.lines, fit(fg(C.cyan, underline(image.ref)), `${fg(C.mag, "/img")}`, inner)]);
	}
	if (info.saved) {
		const saved = info.saved;
		add(6, () => ["", section("RISPARMIO"), `${fg(C.ok, formatTokens(saved))} ${fg(C.dim, "token risparmiati")}`]);
	}
	const usage = info.usage;
	const percent = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value)}%`);
	add(0, () => [
		"",
		section("USO"),
		`${bold(fg(C.text, "5H "))} ${bar(usage.fiveHour)} ${fg(C.text, percent(usage.fiveHour === undefined ? undefined : usage.fiveHour * 100))}`,
		`${bold(fg(C.text, "7G "))} ${bar(usage.sevenDay)} ${fg(C.text, percent(usage.sevenDay === undefined ? undefined : usage.sevenDay * 100))}`,
		`${bold(fg(C.text, "CTX"))} ${bar(usage.contextPercent === undefined ? undefined : usage.contextPercent / 100)} ${fg(C.text, percent(usage.contextPercent))}`,
		fg(C.dim, `    ${usage.contextTokens !== undefined && usage.contextWindow ? `${formatTokens(usage.contextTokens).replace(",0k", "k")}/${formatTokens(usage.contextWindow).replace(",0k", "k")} · ` : ""}${usage.model}·${usage.thinking}`),
	]);
	if (hud) add(8, () => ["", fit(`${fg(C.mag, "◥■")}${fg(C.faint, "■".repeat(Math.max(0, inner - 22)))}`, fg(C.dim, `NODE ${process.pid.toString(16).slice(-4).toUpperCase()} · SYS OK`), inner)]);

	// Short on height: drop the least useful blocks first (sizes measured with a dry render), and say so.
	const sizes = blocks.map((block) => block.render().length);
	sections = 0;
	const kept = new Set(blocks.map((_, index) => index));
	const total = () => [...kept].reduce((sum, index) => sum + sizes[index], 0) + (kept.size < blocks.length ? 2 : 0);
	for (const index of blocks.map((block, index) => ({ index, priority: block.priority })).filter((entry) => entry.priority > 0).sort((a, b) => b.priority - a.priority || b.index - a.index).map((entry) => entry.index)) {
		if (total() <= maxLines) break;
		kept.delete(index);
	}
	const lines = blocks.flatMap((block, index) => (kept.has(index) ? block.render() : []));
	const hidden = blocks.length - kept.size;
	if (hidden) lines.push("", fg(C.dim, `… ${hidden} ${hidden === 1 ? "sezione nascosta" : "sezioni nascoste"} (terminale basso)`));
	// Panel background with a magenta edge, every line exactly `width` columns.
	return lines.map((line) => `${fg(C.mag, "▌")}${bg(C.panel, ` ${pad(truncateToWidth(line, inner, "…"), inner)}`)}`);
}

/** Whether extension statuses (memory, goal, loop, team) differ: the panel is cached and must redraw when they do. */
export function statusesChanged(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): boolean {
	if (before.size !== after.size) return true;
	for (const [key, value] of after) if (before.get(key) !== value) return true;
	return false;
}
