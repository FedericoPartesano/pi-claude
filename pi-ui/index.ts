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
 * Interactive TUI only; PI_UI=off turns it off (the theme stays selectable with /theme).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, type Component, type TUI } from "@earendil-works/pi-tui";
import { linkFileRefs, vscodeUrl, wslDistro } from "./src/answer.ts";
import { renderImageEntry, thumbnailColumns } from "./src/image-entry.ts";
import { findImageRefs, thumbnailFor, type Thumbnail } from "./src/images.ts";
import { C, bold, fg, fit, label } from "./src/palette.ts";
import { PANEL_KEY, PANEL_WIDTH, parseNumstat, parsePorcelain, renderPanel, type ChangedFile } from "./src/panel.ts";
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
	const panelKey = (process.env.PI_UI_PANEL_KEY || PANEL_KEY).toLowerCase();

	let status = initialStatus();
	let frame = 0;
	let files: ChangedFile[] = [];
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
	let cwd = process.cwd();
	let suggestions: string[] = [];
	let lastAnswer = "";
	let pendingAnswer: ((answer: "yes" | "no" | "always") => void) | undefined;
	let statuses: ReadonlyMap<string, string> = new Map();
	let lastFailures: string[] = [];
	let closePanel: (() => void) | undefined;
	/** Thinking being streamed: shown in a dark box above the status bar, gone when the thinking ends. */
	let liveThinking = "";

	// Images of the session: shown once each, thumbnails cached per width.
	const images: string[] = [];
	const thumbnails = new Map<string, Thumbnail | undefined>();
	const thumbnail = (ref: string, cols: number) => {
		const key = `${cols}|${ref}`;
		if (!thumbnails.has(key)) {
			thumbnails.set(key, undefined);
			void thumbnailFor(ref, cwd, cols).then((result) => {
				thumbnails.set(key, result);
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
		}
	};

	const update = (event: StatusEvent) => {
		status = nextStatus(status, event);
		tui?.requestRender();
	};
	const refreshChanges = async (cwd: string) => {
		const [status, numstat] = await Promise.all([
			pi.exec("git", ["status", "--porcelain"], { cwd }).catch(() => undefined),
			pi.exec("git", ["diff", "--numstat", "HEAD"], { cwd }).catch(() => undefined),
		]);
		const counts = numstat?.code === 0 ? parseNumstat(numstat.stdout) : new Map();
		files = status?.code === 0 ? parsePorcelain(status.stdout).map((file) => ({ ...file, ...counts.get(file.path) })) : [];
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
		ctx.ui.setWidget("pi-ui-status", (widgetTui) => {
			tui = widgetTui;
			return line((width) => renderStatusBar(status, width, Date.now(), frame));
		}, { placement: "aboveEditor" });
		ctx.ui.setEditorComponent((editorTui, theme, keybindings) => new PromptEditor(editorTui, theme, keybindings));
		ctx.ui.setFooter((footerTui, _theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => footerTui.requestRender());
			statuses = footerData.getExtensionStatuses();
			return {
				...line((width) => {
					const usage = readUsage();
					return renderFooter({
						statuses: footerData.getExtensionStatuses(),
						project: basename(ctx.cwd),
						branch: footerData.getGitBranch() ?? undefined,
						changes: files.length,
						fiveHour: usage?.fiveHour,
						overage: usage?.overage,
						contextPercent: ctx.getContextUsage()?.percent ?? undefined,
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
		suggestions = [];
		lastAnswer = "";
		clearInterval(spinner);
		spinner = setInterval(() => {
			frame++;
			tui?.requestRender();
		}, 100);
	});
	pi.on("tool_execution_start", (event) => {
		if (!active || event.parentToolCallId) return;
		argsOf.set(event.toolCallId, event.args);
		liveThinking = "";
		update({ type: "tool_start", activity: lower(phrase(event.toolName, event.args).text) });
	});
	pi.on("tool_execution_end", (event) => {
		if (!active || event.parentToolCallId) return;
		const isTestRun = event.toolName === "bash" && /test/.test(phrase("bash", argsOf.get(event.toolCallId)).text);
		const failed = event.toolName === "bash" ? checkOutcome(resultText(event.result), event.isError, isTestRun).failed : event.isError;
		update({ type: "tool_end", failed });
		// Images a tool read or wrote (not every path in its output: an ls of a folder would flood the chat).
		const path = String(argsOf.get(event.toolCallId)?.path ?? "");
		if (!event.isError && IMAGE_FILE.test(path)) noteImages([path]);
		argsOf.delete(event.toolCallId);
	});
	// Thinking streamed by the model: the last lines in a dark box while it reasons; the box goes when it ends.
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
	});
	// The outcome (completed / aborted / error) is only known at the last boundary before settling.
	pi.on("agent_before_settle", (event) => {
		outcome = event.outcome;
		return undefined;
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!active) return;
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
				return {
					render: (width: number) =>
						owner[0]?.id === context.toolCallId
							? renderTurn(owner, Math.max(30, width - (width >= 100 ? reservedRight : 0)), { expanded: context.expanded, finished: owner !== liveTurn, frame, now: Date.now() })
							: [],
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

	pi.registerEntryRenderer<{ ref: string }>("pi-ui-image", (entry) => ({
		render: (width: number) => {
			const ref = entry.data?.ref ?? "";
			// Leave room for the panel: a thumbnail under the overlay would bleed its colors.
			const room = width - (width >= 100 ? reservedRight : 0);
			return renderImageEntry(ref, thumbnail(ref, thumbnailColumns(room)), room);
		},
		invalidate() {},
	}));

	pi.registerEntryRenderer<{ items: string[] }>("pi-ui-suggestions", (entry) => ({
		render: (width: number) => (entry.data?.items?.length ? ["", renderSuggestions(entry.data.items, width)] : []),
		invalidate() {},
	}));

	// The suggestions instruction (about 70 tokens, cached with the system prompt).
	pi.on("before_agent_start", (event) => {
		if (active && process.env.PI_UI_SUGGEST !== "0") event.systemPromptOptions.sections.suggerimenti = SUGGESTION_PROMPT;
		return undefined;
	});

	// Session panel: overlay on the right that never takes the keyboard; steps leave room for it on wide terminals.
	const togglePanel = async (ctx: ExtensionContext) => {
		if (!active) return;
		if (closePanel) return closePanel();
		void refreshChanges(ctx.cwd);
		reservedRight = PANEL_WIDTH + 1;
		await ctx.ui.custom<void>(
			(_panelTui, _theme, _keybindings, done) => {
				closePanel = () => done();
				return {
					render: (width: number) => {
						const usage = readUsage();
						const context = ctx.getContextUsage();
						const last = images[images.length - 1];
						const thumb = last ? thumbnail(last, width - 4) : undefined;
						return renderPanel({
							session: statuses,
							files,
							failures: lastFailures,
							image: last && thumb && "lines" in thumb ? { ref: last, lines: thumb.lines.slice(0, 8) } : undefined,
							usage: {
								fiveHour: usage?.fiveHour,
								sevenDay: usage?.sevenDay,
								contextPercent: context?.percent ?? undefined,
								contextTokens: context?.tokens ?? undefined,
								contextWindow: context?.contextWindow ?? ctx.model?.contextWindow,
								model: ctx.model?.id ?? "?",
								thinking: pi.getThinkingLevel(),
							},
						}, width, panelKey);
					},
					invalidate() {},
				};
			},
			{ overlay: true, overlayOptions: { anchor: "top-right", width: PANEL_WIDTH, margin: { top: 1, right: 0 }, nonCapturing: true, visible: (width) => width >= 60 } },
		);
		closePanel = undefined;
		reservedRight = 0;
		tui?.requestRender();
	};
	pi.registerShortcut(panelKey as Parameters<typeof pi.registerShortcut>[0], { description: "Pannello della sessione: goal/loop/team, file, test, immagini, uso", handler: togglePanel });
	pi.registerCommand("pannello", { description: `Apre o chiude il pannello della sessione (come ${panelKey})`, handler: async (_args, ctx) => togglePanel(ctx) });

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
		const partial = out.lastIndexOf("<!--");
		if (context.isStreaming && partial >= 0 && SUGGESTION_MARK.startsWith(out.slice(partial).trim())) out = out.slice(0, partial).trimEnd();
		if (!out.trim()) return out;
		if (!context.isStreaming && getCapabilities().hyperlinks) out = linkFileRefs(out, cwd, (path, line) => vscodeUrl(path, line, wslDistro()));
		return /^\s*(#|[-*+] |\d+\.|```|>|\|)/.test(out) ? out : `⬢ ${out.trimStart()}`;
	});

	pi.on("session_shutdown", () => {
		clearInterval(spinner);
		active = false;
		askInBar = () => undefined;
		pendingAnswer?.("no");
		pendingAnswer = undefined;
	});
}
