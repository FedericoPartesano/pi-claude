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
import { renderSubscriptionStatus } from "./src/footer.ts";
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

	pi.on("session_shutdown", () => {
		latestContext = undefined;
		disposeAllSessions();
	});

	// Start Claude Code before the first prompt so its cold start is hidden while the user types.
	// Only in the interactive TUI: one-shot print/json runs send their prompt immediately anyway.
	// Deferred so other extensions' handlers for the same event (e.g. tool-groups hiding tools) run first:
	// the pre-warmed session is reused only if its tools and system prompt match the first request.
	const prewarm = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || ctx.model?.provider !== "claude-code") return;
		setTimeout(() => {
			try {
				const model = ctx.model;
				if (!model) return;
				const activeToolNames = new Set(pi.getActiveTools());
				const tools = pi
					.getAllTools()
					.filter((tool) => activeToolNames.has(tool.name))
					.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
				void prewarmSession(model.id, ctx.thinkingLevel, ctx.getSystemPrompt(), tools).catch(() => {});
			} catch {
				// The context went stale before the timer fired (session replaced or shut down).
			}
		}, 0);
	};
	// Footer: subscription window usage (and an overage warning) after each Claude Code answer.
	// Claude Code reports usage right after each answer (after Pi already closed the turn), so the
	// footer is updated when the record arrives, through the latest UI context.
	let latestContext: ExtensionContext | undefined;
	onSubscriptionStatus((info) => {
		try {
			if (latestContext?.model?.provider !== "claude-code") return;
			const theme = latestContext.ui.theme;
			latestContext.ui.setStatus("claude-code", renderSubscriptionStatus(info, Date.now(), (role, text) => theme.fg(role, text)));
		} catch {
			// The context went stale (session replaced or shut down before the usage record arrived).
			latestContext = undefined;
		}
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
