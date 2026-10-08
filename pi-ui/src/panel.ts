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

export function renderPanel(info: PanelInfo, width: number, key = PANEL_KEY): string[] {
	const inner = width - 2;
	// Sections with their icon; the HUD style numbers them: `// 01 SESSIONE`.
	let sections = 0;
	const ICONS: Record<string, IconName> = { SESSIONE: "session", TURNO: "turn", "SUB-AGENTI": "agent", "ATTIVITÀ": "activity", FILE: "files", TEST: "test", MEMORIA: "memory", SUGGERIMENTI: "suggest", GIT: "branch", IMMAGINI: "image", USO: "usage" };
	const section = (title: string, right = "") => {
		sections++;
		const icon = I[ICONS[title] ?? "tool"];
		const name = withIcon(icon ? fg(C.mag, icon) : "", bold(fg(C.text, hud && title === "USO" ? "NET" : title)));
		const head = `${hud ? fg(C.faint, `// ${String(sections).padStart(2, "0")} `) : ""}${name} `;
		const tail = right ? ` ${right}` : "";
		return head + fg(C.border, "─".repeat(Math.max(1, inner - visibleWidth(head) - visibleWidth(tail)))) + tail;
	};
	const title = hud ? `${fg(C.mag, "◢■")} ${bold(fg(C.mag, "SYS//PANNELLO"))}` : bold(fg(C.mag, "PANNELLO"));
	const lines: string[] = [fit(title, `${fg(C.text, key)} ${fg(C.dim, "chiudi")}`, inner), section("SESSIONE")];

	const session = [
		["goal", "GOAL", C.mag],
		["loop", "LOOP", C.cyan],
		["team", "TEAM", C.yel],
	] as const;
	const rows = session.flatMap(([key, tag, color]) => {
		const text = info.session.get(key)?.replace(new RegExp(`^${key}\\s*`, "i"), "");
		return text ? [`${bold(fg(color, tag))} ${fg(C.text, text)}`] : [];
	});
	lines.push(...(rows.length ? rows : [fg(C.dim, "nessun goal, loop o team")]));

	const turn = info.turn;
	if (turn && turn.mode !== "ready") {
		const mark = { working: fg(C.cyan, "⠋"), waiting: fg(C.yel, "◆"), stopped: fg(C.err, "✗"), done: fg(C.ok, "✓") }[turn.mode];
		lines.push("", section("TURNO", mark));
		lines.push(fg(C.text, `${turn.steps} passi · ${turn.seconds < 60 ? `${turn.seconds}s` : formatDuration(turn.seconds * 1000)} · ↑${formatTokens(turn.tokensIn)} ↓${formatTokens(turn.tokensOut)}`));
	}
	if (info.agents?.length) {
		const active = info.agents.filter((agent) => agent.state === "running").length;
		lines.push("", section("SUB-AGENTI", fg(active ? C.cyan : C.dim, `${active} ${active === 1 ? "attivo" : "attivi"} / ${info.agents.length}`)));
		lines.push(...renderAgents(info.agents.slice(-6), inner, info.now ?? Date.now(), Math.floor((info.now ?? Date.now()) / 100)));
	}
	if (info.activity?.length) {
		lines.push("", section("ATTIVITÀ"));
		for (const step of info.activity.slice(-5)) lines.push(`${fg(C.faint, step.time)} ${fg(step.ok ? C.ok : step.icon === "✗" ? C.err : C.cyan, step.icon)} ${fg(C.text, step.text)}`);
	}

	if (info.files.length) {
		lines.push("", section("FILE", fg(C.yel, `✚${info.files.length}`)));
		for (const file of info.files.slice(0, 6)) {
			const color = file.status === "A" ? C.ok : file.status === "D" ? C.err : C.warn;
			const counts = `${file.added ? fg(C.add, `+${file.added}`) : ""}${file.removed ? ` ${fg(C.del, `-${file.removed}`)}` : ""}`.trim();
			lines.push(fit(`${fg(color, file.status)} ${fg(C.cyan, underline(file.path))}`, counts, inner));
		}
		if (info.files.length > 6) lines.push(fg(C.dim, `… altri ${info.files.length - 6}`));
	}
	if (info.failures.length) {
		lines.push("", section("TEST", fg(C.err, `${info.failures.length} ✗`)));
		for (const failure of info.failures.slice(0, 4)) lines.push(`${fg(C.err, "✗")} ${fg(C.text, failure)}`);
	}
	if (info.memory) {
		lines.push("", section("MEMORIA"), fg(C.text, info.memory), fit("", `${fg(C.mag, "/memory")} ${fg(C.dim, "apri")}`, inner));
	}
	if (info.suggestions?.length) {
		lines.push("", section("SUGGERIMENTI"));
		info.suggestions.forEach((text, index) => lines.push(`${fg(C.faint, "⟦")}${fg(C.mag, String(index + 1))}${fg(C.faint, "⟧")} ${fg(C.text, text)}`));
	}
	const git = info.git;
	if (git?.branch) {
		lines.push("", section("GIT"));
		lines.push(`${fg(C.cyan, withIcon(I.branch || "⎇", git.branch))}${git.ahead ? fg(C.ok, ` ↑${git.ahead}`) : ""}${git.behind ? fg(C.warn, ` ↓${git.behind}`) : ""}`);
		if (git.lastCommit) lines.push(fg(C.dim, git.lastCommit));
	}
	if (info.image) {
		lines.push("", section("IMMAGINI"), ...info.image.lines, fit(fg(C.cyan, underline(info.image.ref)), `${fg(C.mag, "/img")}`, inner));
	}
	const usage = info.usage;
	const percent = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value)}%`);
	lines.push(
		"",
		section("USO"),
		`${bold(fg(C.text, "5H "))} ${bar(usage.fiveHour)} ${fg(C.text, percent(usage.fiveHour === undefined ? undefined : usage.fiveHour * 100))}`,
		`${bold(fg(C.text, "7G "))} ${bar(usage.sevenDay)} ${fg(C.text, percent(usage.sevenDay === undefined ? undefined : usage.sevenDay * 100))}`,
		`${bold(fg(C.text, "CTX"))} ${bar(usage.contextPercent === undefined ? undefined : usage.contextPercent / 100)} ${fg(C.text, percent(usage.contextPercent))}`,
		fg(C.dim, `    ${usage.contextTokens !== undefined && usage.contextWindow ? `${formatTokens(usage.contextTokens).replace(",0k", "k")}/${formatTokens(usage.contextWindow).replace(",0k", "k")} · ` : ""}${usage.model}·${usage.thinking}`),
	);
	if (hud) lines.push("", fit(`${fg(C.mag, "◥■")}${fg(C.faint, "■".repeat(Math.max(0, inner - 22)))}`, fg(C.dim, `NODE ${process.pid.toString(16).slice(-4).toUpperCase()} · SYS OK`), inner));
	// Panel background with a magenta edge, every line exactly `width` columns.
	return lines.map((line) => `${fg(C.mag, "▌")}${bg(C.panel, ` ${pad(truncateToWidth(line, inner, "…"), inner)}`)}`);
}
