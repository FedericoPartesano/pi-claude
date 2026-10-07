/**
 * pi-ui: the Neon Night chat for Pi (docs/specs/2026-10-07-pi-ui-design.md).
 *
 * - Status bar above the editor: PRONTO / AL LAVORO / TOCCA A TE / FERMO / FATTO, with what Pi is doing now.
 * - Prompt editor framed `╱─ PROMPT ──┐ … └──╱`, one-line footer (goal/loop/team, project, git, usage).
 * Interactive TUI only; PI_UI=off turns it off (the theme stays selectable with /theme).
 */
import { basename } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { frameEditor } from "./src/editor.ts";
import { renderFooter } from "./src/footer.ts";
import { renderStatusBar } from "./src/status-bar.ts";
import { initialStatus, nextStatus, type StatusEvent } from "./src/status.ts";
import { readUsage } from "./src/usage.ts";

/** Short description of a tool call for the status bar (refined by src/phrases.ts). */
function activityFor(toolName: string, args: Record<string, unknown> | undefined): string {
	const path = String(args?.path ?? args?.file_path ?? "").split("/").pop();
	if (toolName === "read") return `leggo ${path}`;
	if (toolName === "edit") return `modifico ${path}`;
	if (toolName === "write") return `scrivo ${path}`;
	if (toolName === "bash") return `eseguo ${String(args?.command ?? "").split("\n")[0].slice(0, 40)}`;
	return toolName.replace(/_/g, " ");
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
		clearInterval(spinner);
		spinner = setInterval(() => {
			frame++;
			tui?.requestRender();
		}, 100);
	});
	pi.on("tool_execution_start", (event) => {
		if (active && !event.parentToolCallId) update({ type: "tool_start", activity: activityFor(event.toolName, event.args) });
	});
	pi.on("tool_execution_end", (event) => {
		if (active && !event.parentToolCallId) update({ type: "tool_end", failed: event.isError });
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
		void refreshChanges(ctx.cwd);
	});
	pi.on("session_shutdown", () => {
		clearInterval(spinner);
		active = false;
	});
}
