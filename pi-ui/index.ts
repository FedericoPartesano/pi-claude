/**
 * pi-ui: the Neon Night chat for Pi (docs/specs/2026-10-07-pi-ui-design.md).
 *
 * - Status bar above the editor: PRONTO / AL LAVORO / TOCCA A TE / FERMO / FATTO, with what Pi is doing now.
 * - Prompt editor framed `╱─ PROMPT ──┐ … └──╱`, one-line footer (goal/loop/team, project, git, usage).
 * - Steps of a turn as one compact list, folded at the end of the turn unless the last step failed (ctrl+o opens it).
 * - Images named in answers or read/written by tools appear as half-block thumbnails; /img lists and opens them.
 * - `file:riga` in answers link to VS Code where the terminal supports links; answers start with ⬢.
 * - Up to 4 suggestions after a turn, picked with keys 1-4; dangerous commands asked in the status bar (s/n/a);
 *   a Windows notification after long turns. The dangerous-command check stays on even with PI_UI=off.
 * - Alt+S (or /pannello; PI_UI_PANEL_KEY changes the key): session panel on the right (goal/loop/team, changed files,
 *   failing tests, last image, usage).
 * Interactive TUI only; PI_UI=off turns it off (the theme stays selectable in /settings → Theme).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilityOverrides, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { linkFileRefs, vscodeUrl, wslDistro } from "./src/answer.ts";
import { subagentRows, teamRows, type AgentRow } from "./src/agents.ts";
import { CHART_PROMPT, extractCharts, renderChart, type ChartSpec } from "./src/charts.ts";
import { renderImageEntry, renderImageLoading, thumbnailColumns } from "./src/image-entry.ts";
import { findImageRefs, thumbnailFor, type Thumbnail } from "./src/images.ts";
import { C, bg, bold, fg, fit, hud, label, usePalette } from "./src/palette.ts";
import { PINNED_MIN_COLUMNS, sidebarRoot, type SidebarRoot } from "./src/sidebar.ts";
import { imageProtocolFor } from "./src/terminal.ts";
import { activeIntent, planFromBranch, planFromDetails, type PlanTask } from "./src/sources.ts";
import { PANEL_KEY, PANEL_WIDTH, parseAheadBehind, parseNumstat, parsePorcelain, renderPanel, type ChangedFile, type PanelInfo } from "./src/panel.ts";
import { shouldNotify, toastScript } from "./src/notify.ts";
import { answerFor, dangerReason } from "./src/permission.ts";
import { extractSuggestions, renderSuggestions, SUGGESTION_MARK, SUGGESTION_PROMPT } from "./src/suggestions.ts";
import { frameEditor } from "./src/editor.ts";
import { phrase } from "./src/phrases.ts";
import { completeStep, renderTurn, type Step } from "./src/steps.ts";
import { checkOutcome, failingTests } from "./src/test-output.ts";
import { renderFooter } from "./src/footer.ts";
import { renderStatusBar } from "./src/status-bar.ts";
import { elapsedSeconds, initialStatus, nextStatus, type StatusEvent } from "./src/status.ts";
import { RESTART_FILE, writeRestartRequest } from "./src/restart.ts";
import { restoreSession } from "./src/restore.ts";
import { HIDDEN_THINKING_LABEL, renderThinkingBox, thinkingMarkdown } from "./src/thinking.ts";
import { readUsage } from "./src/usage.ts";

/** Text of a tool result (text blocks only). */
const resultText = (result: unknown) =>
	((result as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");

const lower = (text: string) => text[0].toLowerCase() + text.slice(1);
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

/** Opens a file with the desktop's viewer: Windows from WSL (wslview), Linux (xdg-open) or macOS (open). */
async function openExternally(pi: ExtensionAPI, path: string): Promise<boolean> {
	const found = await pi.exec("sh", ["-c", "command -v wslview || command -v xdg-open || command -v open"]).catch(() => undefined);
	const opener = found?.stdout.trim().split("\n")[0];
	if (!opener) return false;
	const result = await pi.exec(opener, [path]).catch(() => undefined);
	return result?.code === 0;
}

const POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

/**
 * Asks before dangerous bash commands. `askInBar` (pi-ui's status bar) is used when it returns an answer; otherwise a
 * dialog; without any UI the command is blocked.
 */
function registerPermissionGate(pi: ExtensionAPI, askInBar: (question: string) => Promise<"yes" | "no" | "always"> | undefined) {
	const allowed = new Set<string>();
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash" || process.env.PI_UI_PERMISSION === "0") return undefined;
		const command = String((event.input as { command?: unknown }).command ?? "");
		const reason = dangerReason(command);
		if (!reason || allowed.has(command)) return undefined;
		if (!ctx.hasUI) return { block: true, reason: `Comando pericoloso bloccato (${reason}): nessuna interfaccia per confermarlo.` };
		const short = command.length > 60 ? `${command.slice(0, 57)}…` : command;
		const inBar = askInBar(`posso eseguire ${short}? ${reason}`);
		const answer = inBar
			? await inBar
			: ({ Sì: "yes", No: "no", "Sì, sempre per questo comando": "always" } as const)[(await ctx.ui.select(`⚠️ Comando pericoloso (${reason}):\n\n  ${command}\n\nLo eseguo?`, ["Sì", "No", "Sì, sempre per questo comando"])) as "Sì"] ?? "no";
		if (answer === "always") allowed.add(command);
		return answer === "no" ? { block: true, reason: "L'utente ha rifiutato il comando." } : undefined;
	});
}

export default function (pi: ExtensionAPI) {
	// Asked in the bar while pi-ui is active, else with a dialog: set below once the TUI is up.
	let askInBar: (question: string) => Promise<"yes" | "no" | "always"> | undefined = () => undefined;
	registerPermissionGate(pi, (question) => askInBar(question));
	if (process.env.PI_UI === "off") return;
	// Real images need a terminal protocol; when detection misses it (e.g. WSL started from WezTerm without its variables),
	// PI_UI_IMAGES=kitty or iterm2 forces it. Under tmux they stay off unless forced (tmux needs allow-passthrough).
	// WezTerm behind Windows ConPTY (WSL or native Windows) gets iTerm2 images; PI_UI_IMAGES=kitty|iterm2 forces one.
	const forcedImages = imageProtocolFor(process.env, process.platform);
	// Measured hot paths (typing on a long session) are cached below; this is a plain call kept for readability.
	const timed = <T>(_name: string, fn: () => T): T => fn();
	if (forcedImages) setCapabilityOverrides({ images: forcedImages });
	const panelKey = (process.env.PI_UI_PANEL_KEY || PANEL_KEY).toLowerCase();

	let status = initialStatus();
	let frame = 0;
	let files: ChangedFile[] = [];
	let git: PanelInfo["git"];
	// Sub-agent tools of the current (or last) turn, for the panel's SUB-AGENTI section.
	const agentCalls = new Map<string, { tool: string; args: Record<string, unknown>; partial?: unknown; lines: string[]; startedAt: number; finished?: { isError: boolean; at: number } }>();
	const agentRows = (): AgentRow[] =>
		[...agentCalls.entries()].flatMap(([id, call]) => {
			if (call.tool === "subagent") return subagentRows(call.args, call.partial as Parameters<typeof subagentRows>[1], call.finished, call.startedAt).map((row) => ({ ...row, key: `${id}:${row.key}` }));
			const rows = teamRows(call.lines, call.startedAt);
			// When the team tool ends, tasks still marked running ended with it.
			return call.finished ? rows.map((row) => (row.state === "running" ? { ...row, state: call.finished!.isError ? ("failed" as const) : ("done" as const), endedAt: call.finished!.at } : row)) : rows;
		});
	/** Latest finished steps for the panel's ATTIVITÀ section. */
	const activity: NonNullable<PanelInfo["activity"]> = [];
	let outcome: "completed" | "aborted" | "error" = "completed";
	let tui: TUI | undefined;
	let spinner: ReturnType<typeof setInterval> | undefined;
	let active = false;
	// Steps grouped by turn. History replayed on resume has no turn events: each of its steps is a turn of its own.
	let liveTurn: Step[] | undefined;
	const turnOf = new Map<string, Step[]>();
	const argsOf = new Map<string, Record<string, unknown>>();
	/** Columns kept free on the right while the session panel is open (part 5). */
	let reservedRight = 0;
	/** Panel pinned as a side column (default; PI_UI_PANEL=float keeps it a toggled overlay). */
	const pinned = process.env.PI_UI_PANEL !== "float";
	let plan: PlanTask[] | undefined;
	let intentInfo: ReturnType<typeof activeIntent>;
	let saved = 0;
	// The running goal (extensions/goal.ts): state, progress, last event; undefined when no goal runs.
	let goalState: PanelInfo["goal"];
	pi.events.on("goal:state", (data) => {
		goalState = data as PanelInfo["goal"];
		panelDirty = true;
		tui?.requestRender();
	});
	// lean-tools reports the tokens its compactions saved.
	pi.events.on("lean:saved", (data) => {
		saved += Number((data as { tokens?: number })?.tokens) || 0;
		panelDirty = true;
	});
	let cwd = process.cwd();
	let suggestions: string[] = [];
	let lastAnswer = "";
	let pendingAnswer: ((answer: "yes" | "no" | "always") => void) | undefined;
	let statuses: ReadonlyMap<string, string> = new Map();
	let lastFailures: string[] = [];
	let closePanel: (() => void) | undefined;
	/** Thinking being streamed: shown in a dark box above the status bar, gone when the thinking ends. */
	let liveThinking = "";

	// Rendered lines of chat components, outside the components: Pi may rebuild or invalidate them on every frame, and
	// re-measuring long ANSI lines on each keystroke made typing slow (profiled). Keys carry everything that changes the
	// output (width, panel state, palette); a bounded map.
	const rendered = new Map<string, string[]>();
	const remember = (key: string, build: () => string[]) => {
		let lines = rendered.get(key);
		if (!lines) {
			lines = build();
			if (rendered.size > 500) rendered.delete(rendered.keys().next().value as string);
			rendered.set(key, lines);
		}
		return lines;
	};
	const turnKeys = new WeakMap<Step[], number>();
	let turnCounter = 0;
	const turnKey = (turn: Step[]) => {
		let key = turnKeys.get(turn);
		if (key === undefined) turnKeys.set(turn, (key = ++turnCounter));
		return key;
	};

	// Images of the session: shown once each, thumbnails cached per width.
	const images: string[] = [];
	const thumbnails = new Map<string, Thumbnail | undefined>();
	// Thumbnails are decoded in a worker thread (src/images.ts); while some are on their way the image entries show an
	// animated loading line, driven by a timer that runs only then.
	const loading = new Set<string>();
	let loadingFrame = 0;
	let loadingTimer: ReturnType<typeof setInterval> | undefined;
	const thumbnail = (ref: string, cols: number) => {
		const key = `${cols}|${ref}`;
		if (!thumbnails.has(key)) {
			thumbnails.set(key, undefined);
			loading.add(key);
			loadingTimer ??= setInterval(() => {
				loadingFrame++;
				tui?.requestRender();
			}, 120);
			void thumbnailFor(ref, cwd, cols).then((result) => {
				thumbnails.set(key, result);
				loading.delete(key);
				if (!loading.size && loadingTimer) {
					clearInterval(loadingTimer);
					loadingTimer = undefined;
				}
				panelDirty = true;
				tui?.requestRender();
			});
		}
		return thumbnails.get(key);
	};
	const noteImages = (refs: string[]) => {
		if (process.env.PI_UI_IMAGES === "0") return;
		for (const ref of refs) {
			if (images.includes(ref)) continue;
			const local = ref.startsWith("~/") ? `${homedir()}/${ref.slice(2)}` : resolve(cwd, ref);
			if (!/^https?:\/\//i.test(ref) && !existsSync(local)) continue;
			images.push(ref);
			pi.appendEntry("pi-ui-image", { ref });
			// A new image is shown at full width: the side column (which would hide it) steps aside; Alt+S brings it back.
			if (sidebarOn && sidebar && getCapabilities().images) {
				sidebarOn = false;
				syncSidebar();
			}
		}
	};

	/** Something the panel shows changed: rebuild it on the next frame (otherwise it is kept, see cachedPanel). */
	let panelDirty = true;
	const update = (event: StatusEvent) => {
		status = nextStatus(status, event);
		panelDirty = true;
		tui?.requestRender();
	};
	// The context size is estimated over the whole session (up to ~5 ms on a long one): at most once a second, not on
	// every keystroke.
	let contextCache: { at: number; value: ReturnType<ExtensionContext["getContextUsage"]> } | undefined;
	const contextUsage = (ctx: ExtensionContext) => {
		const now = Date.now();
		if (!contextCache || now - contextCache.at > 1000) contextCache = { at: now, value: ctx.getContextUsage() };
		return contextCache.value;
	};
	const refreshChanges = async (cwd: string) => {
		const [status, numstat] = await Promise.all([
			pi.exec("git", ["status", "--porcelain"], { cwd }).catch(() => undefined),
			pi.exec("git", ["diff", "--numstat", "HEAD"], { cwd }).catch(() => undefined),
		]);
		const counts = numstat?.code === 0 ? parseNumstat(numstat.stdout) : new Map();
		files = status?.code === 0 ? parsePorcelain(status.stdout).map((file) => ({ ...file, ...counts.get(file.path) })) : [];
		const [branch, aheadBehind, last] = await Promise.all([
			pi.exec("git", ["branch", "--show-current"], { cwd }).catch(() => undefined),
			pi.exec("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], { cwd }).catch(() => undefined),
			pi.exec("git", ["log", "-1", "--format=%s"], { cwd }).catch(() => undefined),
		]);
		git = branch?.code === 0 ? { branch: branch.stdout.trim() || undefined, ...parseAheadBehind(aheadBehind?.code === 0 ? aheadBehind.stdout : ""), lastCommit: last?.code === 0 ? last.stdout.trim() : undefined } : undefined;
		panelDirty = true;
		tui?.requestRender();
	};
	const line = (render: (width: number) => string): Component => ({ render: (width) => [render(width)], invalidate() {} });
	const line_ = (render: (width: number) => string[]): Component => ({ render, invalidate() {} });

	class PromptEditor extends CustomEditor {
		render(width: number): string[] {
			return frameEditor(super.render(width), width, status.mode === "working");
		}

		handleInput(data: string): void {
			// The status bar is asking (TOCCA A TE): s / n / a answer it, other keys go to the editor.
			if (pendingAnswer) {
				const answer = answerFor(data);
				if (answer) {
					const resolveAnswer = pendingAnswer;
					pendingAnswer = undefined;
					update({ type: "resumed" });
					resolveAnswer(answer);
					return;
				}
			}
			// 1-4 on an empty prompt after a turn: put that suggestion in the editor (Enter sends it).
			const pick = /^[1-4]$/.test(data) ? suggestions[Number(data) - 1] : undefined;
			if (pick && status.mode !== "working" && this.getText() === "") {
				this.setText(pick);
				return;
			}
			super.handleInput(data);
		}
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		active = true;
		cwd = ctx.cwd;
		// Resumed session: images for /img and the panel, suggestions for keys 1-4.
		const restored = restoreSession(ctx.sessionManager.getBranch() as Parameters<typeof restoreSession>[0]);
		images.splice(0, images.length, ...restored.images);
		suggestions = restored.suggestions;
		plan = planFromBranch(ctx.sessionManager.getBranch() as Iterable<unknown>);
		intentInfo = activeIntent(ctx.cwd);
		if (process.env.PI_UI_PERMISSION !== "0") {
			askInBar = (question) => new Promise((resolveAnswer) => {
				pendingAnswer = resolveAnswer;
				update({ type: "waiting", question, answers: "s sì · n no · a sempre per questo comando" });
			});
		}
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL);
		ctx.ui.setHeader(() =>
			line((width) =>
				fit(`${label(C.mag, " PI//CLAUDE ")}${fg(C.mag, "╲")} ${bold(fg(C.text, basename(ctx.cwd)))}`, `${fg(C.text, panelKey)} ${fg(C.dim, "pannello ▸")}`, width),
			),
		);
		ctx.ui.setWidget("pi-ui-thinking", () => line_((width) => (status.mode === "working" ? renderThinkingBox(liveThinking, width) : [])), { placement: "aboveEditor" });
		usePalette(ctx.ui.theme.name);
		ctx.ui.setWidget("pi-ui-status", (widgetTui) => {
			tui = widgetTui;
			return line((width) => {
				syncSidebar();
				// The palette follows Pi's theme (/settings → Theme: neon-night, lilla or night-city): on a switch, redraw everything once.
				if (usePalette(ctx.ui.theme.name)) widgetTui.requestRender();
				return renderStatusBar(status, width, Date.now(), frame);
			});
		}, { placement: "aboveEditor" });
		ctx.ui.setEditorComponent((editorTui, theme, keybindings) => new PromptEditor(editorTui, theme, keybindings));
		ctx.ui.setFooter((footerTui, _theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => footerTui.requestRender());
			statuses = footerData.getExtensionStatuses();
			return {
				...line((width) => {
					const usage = timed("readUsage", () => readUsage());
					return renderFooter({
						statuses: footerData.getExtensionStatuses(),
						project: basename(ctx.cwd),
						branch: footerData.getGitBranch() ?? undefined,
						changes: files.length,
						fiveHour: usage?.fiveHour,
						overage: usage?.overage,
						contextPercent: contextUsage(ctx)?.percent ?? undefined,
						model: ctx.model?.id ?? "?",
						thinking: pi.getThinkingLevel(),
					}, width);
				}),
				dispose: unsubscribe,
			};
		});
		void refreshChanges(ctx.cwd);
	});

	pi.on("agent_start", () => {
		if (!active) return;
		outcome = "completed";
		update({ type: "agent_start", at: Date.now() });
		liveTurn = [];
		liveThinking = "";
		agentCalls.clear();
		suggestions = [];
		lastAnswer = "";
		clearInterval(spinner);
		// ~7 frames a second: smooth enough for the spinner and the shimmer, and each frame redraws the whole screen
		// (measured: with the side column, 10 frames a second cost ~40% of a core while Pi writes).
		spinner = setInterval(() => {
			frame++;
			tui?.requestRender();
		}, 150);
	});
	pi.on("tool_execution_start", (event) => {
		if (!active || event.parentToolCallId) return;
		argsOf.set(event.toolCallId, event.args);
		if (event.toolName === "subagent" || event.toolName === "team") agentCalls.set(event.toolCallId, { tool: event.toolName, args: event.args ?? {}, lines: [], startedAt: Date.now() });
		liveThinking = "";
		update({ type: "tool_start", activity: lower(phrase(event.toolName, event.args).text) });
	});
	pi.on("tool_execution_end", (event) => {
		if (!active || event.parentToolCallId) return;
		if (event.toolName === "todo") plan = planFromDetails((event.result as { details?: unknown } | undefined)?.details) ?? plan;
		const isTestRun = event.toolName === "bash" && /test/.test(phrase("bash", argsOf.get(event.toolCallId)).text);
		const failed = event.toolName === "bash" ? checkOutcome(resultText(event.result), event.isError, isTestRun).failed : event.isError;
		update({ type: "tool_end", failed });
		const agentCall = agentCalls.get(event.toolCallId);
		if (agentCall) agentCall.finished = { isError: event.isError, at: Date.now() };
		const time = new Date().toTimeString().slice(0, 8);
		activity.push({ time, icon: failed ? "✗" : "✓", ok: !failed, text: phrase(event.toolName, argsOf.get(event.toolCallId)).text });
		if (activity.length > 20) activity.shift();
		// Images a tool read or wrote (not every path in its output: an ls of a folder would flood the chat).
		const path = String(argsOf.get(event.toolCallId)?.path ?? "");
		if (!event.isError && IMAGE_FILE.test(path)) noteImages([path]);
		argsOf.delete(event.toolCallId);
	});
	// Thinking streamed by the model: the last lines in a dark box while it reasons; the box goes when it ends.
	pi.on("tool_execution_update", (event) => {
		const call = agentCalls.get(event.toolCallId);
		if (!call) return;
		call.partial = event.partialResult;
		// The team sends its last progress lines each time: keep them all, in order.
		if (call.tool === "team") for (const text of resultText(event.partialResult).split("\n")) if (text && !call.lines.includes(text)) call.lines.push(text);
		tui?.requestRender();
	});

	pi.on("message_update", (event) => {
		const streamed = event.assistantMessageEvent as { type: string; contentIndex?: number; partial?: { content?: { type: string; thinking?: string }[] } };
		if (!active || status.mode !== "working") return;
		if (streamed.type === "thinking_delta") {
			liveThinking = streamed.partial?.content?.[streamed.contentIndex ?? -1]?.thinking ?? "";
			if (status.phase !== "thinking") update({ type: "thinking", text: "" });
			else tui?.requestRender();
		} else if (streamed.type === "thinking_end" || streamed.type === "text_start" || streamed.type === "toolcall_start") {
			liveThinking = "";
			tui?.requestRender();
		}
	});

	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } };
		if (!active || message.role !== "assistant" || !message.usage) return;
		const usage = message.usage;
		update({ type: "usage", input: (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0), output: usage.output ?? 0 });
		const content = (event.message as { content?: { type: string; text?: string }[] }).content ?? [];
		const text = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
		if (text.trim()) lastAnswer = text;
		noteImages(findImageRefs(extractSuggestions(text).text));
		// Charts written by the model: drawn under the answer (the block itself is hidden by the transformer).
		if (process.env.PI_UI_CHARTS !== "0") for (const chart of extractCharts(text).charts) pi.appendEntry("pi-ui-chart", { chart });
	});
	// The outcome (completed / aborted / error) is only known at the last boundary before settling.
	pi.on("agent_before_settle", (event) => {
		outcome = event.outcome;
		return undefined;
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!active) return;
		intentInfo = activeIntent(ctx.cwd);
		clearInterval(spinner);
		liveThinking = "";
		update({ type: "settled", at: Date.now(), outcome });
		const failed = (liveTurn ?? []).filter((step) => step.error);
		// The panel's TEST section lists failing tests only (other errors stay visible in the step list).
		lastFailures = failed.flatMap((step) => failingTests(step.output ?? ""));
		liveTurn = undefined;
		const answer = extractSuggestions(lastAnswer);
		suggestions = outcome === "completed" ? answer.suggestions : [];
		if (suggestions.length) pi.appendEntry("pi-ui-suggestions", { items: suggestions });
		update({ type: "suggestions", count: suggestions.length });
		if (process.env.PI_UI_NOTIFY !== "0" && shouldNotify(elapsedSeconds(status, Date.now()), status.mode)) {
			process.stdout.write("\x07");
			const title = status.mode === "done" ? "Pi ha finito" : "Pi si è fermato";
			const body = (answer.text.replace(/[#*`_>\[\]]/g, "").trim().split("\n")[0] || status.activity).slice(0, 120);
			if (existsSync(POWERSHELL)) void pi.exec(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", toastScript(title, body)]).catch(() => undefined);
		}
		void refreshChanges(ctx.cwd);
	});
	pi.registerToolRenderer((toolName, next) => {
		if (process.env.PI_UI_STEPS === "0") return next();
		return {
			...next(),
			renderShell: "self",
			renderCall: (args, _theme, context) => {
				let turn = turnOf.get(context.toolCallId);
				if (!turn) {
					turn = liveTurn ?? [];
					// History replayed on resume has no timing: only live steps get a start time.
					turn.push({ id: context.toolCallId, tool: toolName, args: (args ?? {}) as Record<string, unknown>, startedAt: liveTurn ? Date.now() : undefined });
					turnOf.set(context.toolCallId, turn);
				}
				const owner = turn;
				const step = owner.find((candidate) => candidate.id === context.toolCallId);
				if (step && args) step.args = args as Record<string, unknown>;
				// Pi renders every component on every frame (each keystroke): a finished turn's rows are kept and rebuilt
				// only when the width, the expansion or its steps change (measured: ~80 ms per keystroke on a long session).
				return {
					render: (width: number) => {
						if (owner[0]?.id !== context.toolCallId) return [];
						const room = Math.max(30, width - (width >= 100 ? reservedRight : 0));
						const finished = owner !== liveTurn;
						if (!finished) return renderTurn(owner, room, { expanded: context.expanded, finished, frame, now: Date.now() });
						const key = `turn|${turnKey(owner)}|${room}|${context.expanded}|${owner.length}|${owner.filter((entry) => entry.done).length}|${C.mag}`;
						return remember(key, () => renderTurn(owner, room, { expanded: context.expanded, finished, frame, now: Date.now() }));
					},
					invalidate() {},
				};
			},
			renderResult: (result, options, _theme, context) => {
				const turn = turnOf.get(context.toolCallId);
				const index = turn?.findIndex((candidate) => candidate.id === context.toolCallId) ?? -1;
				// Completed once: later re-renders (ctrl+o, resize) must not move its end time.
				if (turn && index >= 0 && !options.isPartial && !turn[index].done) {
					const completed = completeStep(turn[index], { output: resultText(result), isError: context.isError, details: (result as { details?: { patch?: string } }).details });
					turn[index] = { ...completed, endedAt: completed.startedAt ? Date.now() : undefined };
				}
				return { render: () => [], invalidate() {} };
			},
		};
	});

	pi.registerEntryRenderer<{ ref: string }>("pi-ui-image", (entry) => {
		// Kept per width, panel state and thumbnail: re-measuring every thumbnail line on each keystroke was the main
		// cost of typing in sessions with many images (profiled: ~3 s of CPU for 45 keystrokes).
		return {
			render: (width: number) => {
				const ref = entry.data?.ref ?? "";
				// Leave room for the panel: a thumbnail under the overlay would bleed its colors.
				const room = width - (width >= 100 ? reservedRight : 0);
				const thumb = thumbnail(ref, thumbnailColumns(room));
				// Not ready yet (decoding in the worker): an animated loading line.
				if (!thumb) return renderImageLoading(ref, room, loadingFrame).map((line) => line + " ".repeat(Math.max(0, width - room)));
				return remember(`img|${ref}|${width}|${room}|${Boolean(sidebar)}|${C.mag}|${"error" in thumb}`, () => renderImageEntry(ref, thumb, room, { sidebarOpen: Boolean(sidebar) }));
			},
			invalidate() {},
		};
	});

	pi.registerEntryRenderer<{ chart: ChartSpec }>("pi-ui-chart", (entry) => {
		return {
			render: (width: number) => {
				const chart = entry.data?.chart;
				if (!chart) return [];
				// Full-width lines (and room for the open panel): see renderImageEntry. Kept per width and palette.
				const room = width - (width >= 100 ? reservedRight : 0);
				return remember(`chart|${JSON.stringify(chart).slice(0, 200)}|${width}|${room}|${C.mag}`, () => ["", ...renderChart(chart, room).map((line) => line + " ".repeat(Math.max(0, width - room)))]);
			},
			invalidate() {},
		};
	});

	pi.registerEntryRenderer<{ items: string[] }>("pi-ui-suggestions", (entry) => {
		return {
			render: (width: number) => {
				const items = entry.data?.items;
				if (!items?.length) return [];
				return remember(`sugg|${items.join("|")}|${width}|${C.mag}`, () => ["", renderSuggestions(items, width)]);
			},
			invalidate() {},
		};
	});

	// The suggestions instruction (about 70 tokens, cached with the system prompt).
	pi.on("before_agent_start", (event) => {
		if (active && process.env.PI_UI_SUGGEST !== "0") event.systemPromptOptions.sections.suggerimenti = SUGGESTION_PROMPT;
		if (active && process.env.PI_UI_CHARTS !== "0") event.systemPromptOptions.sections.grafici = CHART_PROMPT;
		return undefined;
	});

	// Session panel. Fullscreen on a wide terminal: a real side column (the layout root becomes an hstack, see
	// src/sidebar.ts). Otherwise an overlay on the right that never takes the keyboard; steps leave room for it.
	let panelCtx: ExtensionContext | undefined;
	const panelLines = (ctx: ExtensionContext, width: number, column: boolean): string[] => {
		const usage = timed("readUsage", () => readUsage());
		const context = contextUsage(ctx);
		const last = images[images.length - 1];
		const thumb = last ? thumbnail(last, width - 4) : undefined;
		const rows = process.stdout.rows ?? 40;
		const lines = renderPanel({
			session: statuses,
			files,
			failures: lastFailures,
			image: last && thumb && "lines" in thumb ? { ref: last, lines: thumb.lines.slice(0, 8) } : undefined,
			turn: { mode: status.mode, steps: status.step, seconds: elapsedSeconds(status, Date.now()), tokensIn: status.tokensIn, tokensOut: status.tokensOut },
			activity,
			git,
			memory: statuses.get("memory"),
			suggestions,
			agents: agentRows(),
			now: Date.now(),
			plan,
			goal: goalState,
			// The goal section already shows its intent.
			intent: goalState?.intentFile && goalState.intentFile === intentInfo?.file ? undefined : intentInfo,
			saved,
			usage: {
				fiveHour: usage?.fiveHour,
				sevenDay: usage?.sevenDay,
				contextPercent: context?.percent ?? undefined,
				contextTokens: context?.tokens ?? undefined,
				contextWindow: context?.contextWindow ?? ctx.model?.contextWindow,
				model: ctx.model?.id ?? "?",
				thinking: pi.getThinkingLevel(),
			},
		}, width, panelKey, Math.max(12, rows - (column ? 1 : 3)));
		// As a column it runs to the bottom of the screen.
		const blank = `${fg(C.mag, "▌")}${bg(C.panel, " ".repeat(Math.max(0, width - 1)))}`;
		return column && lines.length < rows - 1 ? [...lines, ...Array(rows - 1 - lines.length).fill(blank)] : lines;
	};

	type LayoutHost = { layoutRoot?: Component; setLayoutRoot?: (component: Component | undefined) => void; requestRender: () => void };
	let sidebarOn = false;
	let sidebar: SidebarRoot | undefined;
	// The panel is rebuilt when something it shows changed, every 300 ms while Pi works (timers, spinners) and every
	// 2 s otherwise: typing does not rebuild it (it reads files and the context size).
	let panelCache: { at: number; width: number; column: boolean; lines: string[] } | undefined;
	const cachedPanel = (ctx: ExtensionContext, width: number, column: boolean) => {
		const now = Date.now();
		const age = panelCache ? now - panelCache.at : Infinity;
		if (!panelCache || panelCache.width !== width || panelCache.column !== column || (panelDirty && age > 100) || age > (status.mode === "working" ? 300 : 2000)) {
			panelDirty = false;
			panelCache = { at: now, width, column, lines: timed("pannello", () => panelLines(ctx, width, column)) };
		}
		return panelCache.lines;
	};
	const sidebarComponent: Component = { render: (width) => (panelCtx ? cachedPanel(panelCtx, width, true) : []), invalidate() {} };
	const wide = () => (process.stdout.columns ?? 0) >= PINNED_MIN_COLUMNS;
	/** Fullscreen renderer with a layout root to wrap (regular mode has none: the overlay is used there). */
	const layoutHost = (): LayoutHost | undefined => {
		const host = tui as unknown as LayoutHost | undefined;
		return host && typeof host.setLayoutRoot === "function" && (host.layoutRoot || sidebar) ? host : undefined;
	};
	/**
	 * Regular mode (no layout root): the panel is an overlay and the chat renders narrower while it is open on a wide
	 * terminal, patched on the renderer's class (reached through the proxy's prototype; Pi may swap the instance).
	 */
	const fullscreen = () => typeof (tui as unknown as LayoutHost | undefined)?.setLayoutRoot === "function";
	const regularColumn = () => Boolean(closePanel) && !fullscreen() && wide();
	const patchRegularRender = () => {
		const proto = (tui ? Object.getPrototypeOf(tui) : null) as { render: (width: number) => string[] } | null;
		if (!proto || Object.prototype.hasOwnProperty.call(proto, "piUiColumn")) return;
		const original = proto.render;
		proto.render = function (this: unknown, width: number) {
			if (!regularColumn()) return original.call(this, width);
			// No padding: the regular renderer erases each line it writes, and measuring every line of the conversation
			// on each frame cost ~40 ms per keystroke on a long session.
			return original.call(this, Math.max(20, width - PANEL_WIDTH - 1));
		};
		Object.defineProperty(proto, "piUiColumn", { value: true });
	};
	/**
	 * Frame cap for throttled redraws (streaming text, spinners): Pi redraws up to 60 times a second, and each frame with
	 * the side column costs several ms on a long session. Keys use Pi's immediate redraw and are not affected.
	 * PI_UI_FPS (default 30) sets it; found through the renderer's prototype chain (the class with the static field).
	 */
	let frameCapped = false;
	const capFrameRate = () => {
		if (frameCapped || !tui) return;
		frameCapped = true;
		const fps = Math.max(10, Math.min(60, Number(process.env.PI_UI_FPS) || 30));
		for (let proto = Object.getPrototypeOf(tui); proto; proto = Object.getPrototypeOf(proto)) {
			const owner = proto.constructor as { MIN_RENDER_INTERVAL_MS?: number } | undefined;
			if (owner && Object.prototype.hasOwnProperty.call(owner, "MIN_RENDER_INTERVAL_MS")) {
				owner.MIN_RENDER_INTERVAL_MS = Math.round(1000 / fps);
				return;
			}
		}
	};
	/** Wraps or unwraps Pi's layout root to match sidebarOn (Pi may set its root again: checked on every frame). */
	const syncSidebar = () => {
		capFrameRate();
		const host = layoutHost();
		if (!host) return fullscreen() ? undefined : patchRegularRender();
		const current = host.layoutRoot;
		const wanted = sidebarOn && wide();
		if (wanted && current && current !== sidebar) {
			sidebar = sidebarRoot(current, sidebarComponent, PANEL_WIDTH);
			const next = sidebar;
			setTimeout(() => {
				host.setLayoutRoot?.(next);
				host.requestRender();
			}, 0);
		} else if (!wanted && sidebar && current === sidebar) {
			const inner = sidebar.inner;
			sidebar = undefined;
			setTimeout(() => {
				host.setLayoutRoot?.(inner);
				host.requestRender();
			}, 0);
		}
	};

	const togglePanel = async (ctx: ExtensionContext) => {
		if (!active) return;
		panelCtx = ctx;
		if (layoutHost() && wide()) {
			// Side column: Alt+S hides and shows it.
			if (closePanel) closePanel();
			sidebarOn = !sidebarOn;
			if (sidebarOn) void refreshChanges(ctx.cwd);
			syncSidebar();
			tui?.requestRender();
			return;
		}
		if (closePanel) return closePanel();
		void refreshChanges(ctx.cwd);
		// Regular mode on a wide terminal: the chat is narrower (patchRegularRender), the steps need no extra room.
		reservedRight = wide() ? 0 : PANEL_WIDTH + 1;
		await ctx.ui.custom<void>(
			(_panelTui, _theme, _keybindings, done) => {
				closePanel = () => done();
				return { render: (width: number) => cachedPanel(ctx, width, wide()), invalidate() {} };
			},
			{ overlay: true, overlayOptions: { anchor: "top-right", width: PANEL_WIDTH, maxHeight: wide() ? "100%" : "95%", margin: { top: wide() ? 0 : 1, right: 0 }, nonCapturing: true, visible: (width) => width >= 60 } },
		);
		closePanel = undefined;
		reservedRight = 0;
		tui?.requestRender();
	};
	// Pinned: the panel opens with the session as a side column on wide terminals (Alt+S still hides and shows it).
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !pinned) return;
		panelCtx = ctx;
		// The side column only on wide terminals: fullscreen through the layout root, regular mode as an overlay next to
		// a narrower chat. Narrow terminals: on demand (an overlay opened by itself would cover the chat).
		sidebarOn = true;
		void refreshChanges(ctx.cwd);
		setTimeout(() => {
			if (tui && !fullscreen() && wide() && !closePanel) void togglePanel(ctx);
		}, 50);
	});
	pi.registerShortcut(panelKey as Parameters<typeof pi.registerShortcut>[0], { description: "Pannello della sessione: goal/loop/team, file, test, immagini, uso", handler: togglePanel });
	pi.registerCommand("pannello", { description: `Apre o chiude il pannello della sessione (come ${panelKey})`, handler: async (_args, ctx) => togglePanel(ctx) });

	// /custom-reload: full restart on the same conversation (Pi's /reload only reloads resources inside this process).
	pi.registerCommand("custom-reload", {
		description: "Riavvia Pi da capo (estensioni, bridge, impostazioni) e riapre questa conversazione",
		handler: async (_args, ctx) => {
			if (process.env.PI_UI_LOOP !== "1") {
				return ctx.ui.notify("Pi non è stato aperto dal comando pi di pi-ui, quindi non ripartirebbe: apri un nuovo terminale dopo ./install.sh, oppure usa /reload.", "warning");
			}
			let session = "";
			try {
				session = ctx.sessionManager.getSessionFile() ?? "";
			} catch {
				// Ephemeral session (--no-session): restart with a new chat.
			}
			writeRestartRequest(RESTART_FILE, { session, cwd: ctx.cwd });
			ctx.ui.notify(session ? "Riavvio Pi e riapro questa conversazione…" : "Sessione non salvata (--no-session): riavvio con una chat nuova…", "info");
			ctx.shutdown();
		},
	});

	pi.registerCommand("img", {
		description: "Immagini della sessione: anteprima e apertura a piena qualità (Invio)",
		handler: async (_args, ctx) => {
			if (images.length === 0) return ctx.ui.notify("Nessuna immagine in questa sessione.", "info");
			const [{ pick }, { listSource }] = await Promise.all([import("../pi-picker/src/pick.ts"), import("../pi-picker/src/sources.ts")]);
			const items = [...images].reverse().map((ref) => ({ value: ref, label: ref }));
			const chosen = await pick(ctx, {
				title: "Immagini della sessione",
				source: listSource(items),
				rawPreview: true,
				preview: async (item) => {
					const result = await thumbnailFor(item.value, cwd, 36);
					return "lines" in result ? [...result.lines, "", result.info].join("\n") : result.error;
				},
			});
			const ref = chosen?.[0];
			if (!ref) return;
			const result = await thumbnailFor(ref, cwd, 8);
			const path = "path" in result ? result.path : resolve(cwd, ref);
			if (!(await openExternally(pi, path))) ctx.ui.notify(`Non riesco ad aprire ${path}: installa wslu (wslview) o xdg-utils.`, "warning");
		},
	});

	// Answers: ⬢ in front, file:riga as VS Code links where the terminal shows links (never printed as raw URLs).
	pi.registerMarkdownTransformer((markdown, context) => {
		if (!active || !markdown.trim()) return markdown;
		if (context.messageType === "assistant-thinking") return thinkingMarkdown(markdown);
		if (context.messageType !== "assistant") return markdown;
		// The suggestions block is shown under the turn, not in the answer (while streaming, cut a half-written mark too).
		let out = extractSuggestions(markdown).text;
		out = extractCharts(out).text;
		// A chart block still being written: hide it until it is complete.
		const open = out.search(/```(?:grafico|chart)\b/);
		if (context.isStreaming && open >= 0) out = `${out.slice(0, open)}▦ *preparo un grafico…*`;
		const partial = out.lastIndexOf("<!--");
		if (context.isStreaming && partial >= 0 && SUGGESTION_MARK.startsWith(out.slice(partial).trim())) out = out.slice(0, partial).trimEnd();
		if (!out.trim()) return out;
		if (!context.isStreaming && getCapabilities().hyperlinks) out = linkFileRefs(out, cwd, (path, line) => vscodeUrl(path, line, wslDistro()));
		return /^\s*(#|[-*+] |\d+\.|```|>|\|)/.test(out) ? out : `${hud ? "◢" : "⬢"} ${out.trimStart()}`;
	});

	pi.on("session_shutdown", () => {
		clearInterval(spinner);
		active = false;
		askInBar = () => undefined;
		pendingAnswer?.("no");
		pendingAnswer = undefined;
	});
}
