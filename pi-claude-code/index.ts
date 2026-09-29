/**
 * pi-claude-code: a Pi provider that runs Claude models through the official Claude Code CLI,
 * so requests count against the Claude subscription like any other Claude Code session.
 *
 * Usage:
 *   pi -e ./pi-claude-code --provider claude-code --model sonnet
 *
 * Environment:
 *   PI_CLAUDE_BINARY  path to the `claude` executable (default: `claude` on PATH)
 *   PI_CLAUDE_DEBUG   file path; when set, the bridge logs the Claude Code stream there
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { disposeAllSessions, onSubscriptionStatus, prewarmSession, streamClaudeCode } from "./src/provider.ts";

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Every Pi level is supported; the provider maps it to Claude Code --effort.
const thinkingLevelMap = { off: "off", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };

// Claude Code's auto-compaction is disabled by the bridge, so Pi owns the full window.
const CONTEXT_WINDOW = 200_000;

export default function (pi: ExtensionAPI) {
	pi.registerProvider("claude-code", {
		name: "Claude Code (subscription)",
		baseUrl: "claude-code://local",
		apiKey: "subscription",
		api: "claude-code-cli",
		models: [
			{
				id: "sonnet",
				name: "Claude Sonnet (Claude Code)",
				reasoning: true,
				thinkingLevelMap,
				input: ["text", "image"],
				cost: zeroCost,
				contextWindow: CONTEXT_WINDOW,
				maxTokens: 64_000,
			},
			{
				id: "opus",
				name: "Claude Opus (Claude Code)",
				reasoning: true,
				thinkingLevelMap,
				input: ["text", "image"],
				cost: zeroCost,
				contextWindow: CONTEXT_WINDOW,
				maxTokens: 64_000,
			},
			{
				id: "haiku",
				name: "Claude Haiku (Claude Code)",
				reasoning: true,
				thinkingLevelMap,
				input: ["text", "image"],
				cost: zeroCost,
				contextWindow: CONTEXT_WINDOW,
				maxTokens: 32_000,
			},
		],
		streamSimple: streamClaudeCode,
	});

	pi.on("session_shutdown", () => disposeAllSessions());

	// Start Claude Code before the first prompt so its cold start is hidden while the user types.
	// Only in the interactive TUI: one-shot print/json runs send their prompt immediately anyway.
	const prewarm = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || ctx.model?.provider !== "claude-code") return;
		const activeToolNames = new Set(pi.getActiveTools());
		const tools = pi
			.getAllTools()
			.filter((tool) => activeToolNames.has(tool.name))
			.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
		void prewarmSession(ctx.model.id, ctx.thinkingLevel, ctx.getSystemPrompt(), tools).catch(() => {});
	};
	// Footer: subscription window usage (and an overage warning) after each Claude Code answer.
	// Claude Code reports usage right after each answer (after Pi already closed the turn), so the
	// footer is updated when the record arrives, through the latest UI context.
	let latestContext: ExtensionContext | undefined;
	onSubscriptionStatus((text) => {
		if (latestContext?.model?.provider === "claude-code") latestContext.ui.setStatus("claude-code", text);
	});
	pi.on("message_end", (_event, ctx) => {
		latestContext = ctx;
	});

	pi.on("session_start", (_event, ctx) => {
		latestContext = ctx;
		prewarm(ctx);
	});
	pi.on("model_select", (_event, ctx) => prewarm(ctx));
	pi.on("thinking_level_select", (_event, ctx) => prewarm(ctx));
}
