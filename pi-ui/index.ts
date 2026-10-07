/**
 * pi-ui: the Neon Night chat for Pi (docs/specs/2026-10-07-pi-ui-design.md).
 *
 * - Status bar above the editor: PRONTO / AL LAVORO / TOCCA A TE / FERMO / FATTO, with what Pi is doing now.
 * - Prompt editor framed `╱─ PROMPT ──┐ … └──╱`, one-line footer (goal/loop/team, project, git, usage).
 * - Steps of a turn as one compact list, folded at the end of the turn unless the last step failed (ctrl+o opens it).
 * Interactive TUI only; PI_UI=off turns it off (the theme stays selectable with /theme).
 */
import { basename } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
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
		argsOf.delete(event.toolCallId);
		const failed = event.toolName === "bash" ? checkOutcome(resultText(event.result), event.isError, isTestRun).failed : event.isError;
		update({ type: "tool_end", failed });
	});
	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } };
		if (!active || message.role !== "assistant" || !message.usage) return;
		const usage = message.usage;
		update({ type: "usage", input: (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0), output: usage.output ?? 0 });
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

	pi.on("session_shutdown", () => {
		clearInterval(spinner);
		active = false;
	});
}
