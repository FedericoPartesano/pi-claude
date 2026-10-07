/**
 * pi-ui: the Neon Night chat for Pi (docs/specs/2026-10-07-pi-ui-design.md).
 *
 * - Status bar above the editor: PRONTO / AL LAVORO / TOCCA A TE / FERMO / FATTO, with what Pi is doing now.
 * - Prompt editor framed `╱─ PROMPT ──┐ … └──╱`, one-line footer (goal/loop/team, project, git, usage).
 * - Steps of a turn as one compact list, folded at the end of the turn unless the last step failed (ctrl+o opens it).
 * - Images named in answers or read/written by tools appear as half-block thumbnails; /img lists and opens them.
 * - `file:riga` in answers link to VS Code where the terminal supports links; answers start with ⬢.
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
import { frameEditor } from "./src/editor.ts";
import { phrase } from "./src/phrases.ts";
import { completeStep, renderTurn, type Step } from "./src/steps.ts";
import { checkOutcome } from "./src/test-output.ts";
import { renderFooter } from "./src/footer.ts";
import { renderStatusBar } from "./src/status-bar.ts";
import { initialStatus, nextStatus, type StatusEvent } from "./src/status.ts";
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

export default function (pi: ExtensionAPI) {
	if (process.env.PI_UI === "off") return;

	let status = initialStatus();
	let frame = 0;
	let changes = 0;
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
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd }).catch(() => undefined);
		changes = result?.code === 0 ? result.stdout.split("\n").filter(Boolean).length : 0;
		tui?.requestRender();
	};
	const line = (render: (width: number) => string): Component => ({ render: (width) => [render(width)], invalidate() {} });

	class PromptEditor extends CustomEditor {
		render(width: number): string[] {
			return frameEditor(super.render(width), width, status.mode === "working");
		}
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		active = true;
		cwd = ctx.cwd;
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setWidget("pi-ui-status", (widgetTui) => {
			tui = widgetTui;
			return line((width) => renderStatusBar(status, width, Date.now(), frame));
		}, { placement: "aboveEditor" });
		ctx.ui.setEditorComponent((editorTui, theme, keybindings) => new PromptEditor(editorTui, theme, keybindings));
		ctx.ui.setFooter((footerTui, _theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => footerTui.requestRender());
			return {
				...line((width) => {
					const usage = readUsage();
					return renderFooter({
						statuses: footerData.getExtensionStatuses(),
						project: basename(ctx.cwd),
						branch: footerData.getGitBranch() ?? undefined,
						changes,
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
		clearInterval(spinner);
		spinner = setInterval(() => {
			frame++;
			tui?.requestRender();
		}, 100);
	});
	pi.on("tool_execution_start", (event) => {
		if (!active || event.parentToolCallId) return;
		argsOf.set(event.toolCallId, event.args);
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
	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } };
		if (!active || message.role !== "assistant" || !message.usage) return;
		const usage = message.usage;
		update({ type: "usage", input: (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0), output: usage.output ?? 0 });
		const content = (event.message as { content?: { type: string; text?: string }[] }).content ?? [];
		noteImages(findImageRefs(content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n")));
	});
	// The outcome (completed / aborted / error) is only known at the last boundary before settling.
	pi.on("agent_before_settle", (event) => {
		outcome = event.outcome;
		return undefined;
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!active) return;
		clearInterval(spinner);
		update({ type: "settled", at: Date.now(), outcome });
		liveTurn = undefined;
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
					turn.push({ id: context.toolCallId, tool: toolName, args: (args ?? {}) as Record<string, unknown> });
					turnOf.set(context.toolCallId, turn);
				}
				const owner = turn;
				const step = owner.find((candidate) => candidate.id === context.toolCallId);
				if (step && args) step.args = args as Record<string, unknown>;
				return {
					render: (width: number) =>
						owner[0]?.id === context.toolCallId
							? renderTurn(owner, Math.max(30, width - reservedRight), { expanded: context.expanded, finished: owner !== liveTurn, frame })
							: [],
					invalidate() {},
				};
			},
			renderResult: (result, options, _theme, context) => {
				const turn = turnOf.get(context.toolCallId);
				const index = turn?.findIndex((candidate) => candidate.id === context.toolCallId) ?? -1;
				if (turn && index >= 0 && !options.isPartial) {
					turn[index] = completeStep(turn[index], { output: resultText(result), isError: context.isError, details: (result as { details?: { patch?: string } }).details });
				}
				return { render: () => [], invalidate() {} };
			},
		};
	});

	pi.registerEntryRenderer<{ ref: string }>("pi-ui-image", (entry) => ({
		render: (width: number) => {
			const ref = entry.data?.ref ?? "";
			return renderImageEntry(ref, thumbnail(ref, thumbnailColumns(width)), width);
		},
		invalidate() {},
	}));

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
		if (!active || context.messageType !== "assistant" || !markdown.trim()) return markdown;
		let out = markdown;
		if (!context.isStreaming && getCapabilities().hyperlinks) out = linkFileRefs(out, cwd, (path, line) => vscodeUrl(path, line, wslDistro()));
		return /^\s*(#|[-*+] |\d+\.|```|>|\|)/.test(out) ? out : `⬢ ${out.trimStart()}`;
	});

	pi.on("session_shutdown", () => {
		clearInterval(spinner);
		active = false;
	});
}
