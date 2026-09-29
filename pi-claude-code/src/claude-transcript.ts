/**
 * Writes a Pi transcript as a Claude Code session file, so a fresh `claude` process can
 * `--resume` it and see the history as real messages (tool_use/tool_result blocks, signed
 * thinking, images) instead of a text replay. Used after Pi forks, tree navigation,
 * compaction, model or prompt changes, and aborts.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { claudeToolName } from "./claude-session.ts";

export const CLAUDE_CODE_API = "claude-code-cli";

type ConversationMessage = Exclude<Message, { role: "system" }>;
type AnthropicBlock = Record<string, unknown>;

interface SessionEntry {
	role: "user" | "assistant";
	content: AnthropicBlock[];
	model?: string;
}

export interface WrittenSession {
	sessionId: string;
	dispose: () => void;
}

/** Claude Code stores sessions under `<config>/projects/<cwd with non-alphanumerics as '-'>`. */
export function claudeProjectDirectory(cwd: string): string {
	const configDirectory = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	return join(configDirectory, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

export function writeClaudeSession(history: ConversationMessage[], cwd: string, model: string): WrittenSession {
	const sessionId = randomUUID();
	const directory = claudeProjectDirectory(cwd);
	mkdirSync(directory, { recursive: true });
	const file = join(directory, `${sessionId}.jsonl`);

	const toolIds = new ToolIdMap();
	const entries = mergeConsecutiveRoles(history.map((message) => toSessionEntry(message, toolIds, model)).filter(isNonEmpty));

	let parentUuid: string | null = null;
	const lines = entries.map((entry, index) => {
		const uuid = randomUUID();
		const timestamp = new Date(Date.now() - (entries.length - index) * 1000).toISOString();
		const line = {
			parentUuid,
			isSidechain: false,
			userType: "external",
			cwd,
			sessionId,
			type: entry.role,
			uuid,
			timestamp,
			message:
				entry.role === "user"
					? { role: "user", content: entry.content }
					: {
							id: `msg_pi_${uuid.replace(/-/g, "")}`,
							type: "message",
							role: "assistant",
							model: entry.model ?? model,
							content: entry.content,
							stop_reason: entry.content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
							stop_sequence: null,
							usage: { input_tokens: 0, output_tokens: 0 },
						},
		};
		parentUuid = uuid;
		return JSON.stringify(line);
	});
	writeFileSync(file, `${lines.join("\n")}\n`);
	return { sessionId, dispose: () => rmSync(file, { force: true }) };
}

function toSessionEntry(message: ConversationMessage, toolIds: ToolIdMap, model: string): SessionEntry {
	switch (message.role) {
		case "user":
			return { role: "user", content: toContentBlocks(message.content) };
		case "toolResult":
			return { role: "user", content: [toToolResultBlock(message, toolIds)] };
		case "assistant":
			return { role: "assistant", content: toAssistantBlocks(message, toolIds), model: message.responseModel ?? model };
	}
}

function toAssistantBlocks(message: AssistantMessage, toolIds: ToolIdMap): AnthropicBlock[] {
	// Signed thinking can only be replayed to the provider that produced it.
	const replaySignedThinking = message.api === CLAUDE_CODE_API;
	const blocks: AnthropicBlock[] = [];
	for (const block of message.content) {
		if (block.type === "text") {
			if (block.text.trim()) blocks.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			if (replaySignedThinking && block.redacted && block.thinkingSignature) {
				blocks.push({ type: "redacted_thinking", data: block.thinkingSignature });
			} else if (replaySignedThinking && block.thinkingSignature) {
				blocks.push({ type: "thinking", thinking: block.thinking, signature: block.thinkingSignature });
			} else if (block.thinking.trim()) {
				// Same fallback as Pi's Anthropic provider for unsigned thinking from other providers.
				blocks.push({ type: "text", text: block.thinking });
			}
		} else if (block.type === "toolCall") {
			blocks.push({
				type: "tool_use",
				id: toolIds.get(block.id),
				name: claudeToolName(block.name),
				input: block.arguments,
			});
		}
	}
	return blocks;
}

function toToolResultBlock(message: ToolResultMessage, toolIds: ToolIdMap): AnthropicBlock {
	const content = toContentBlocks(message.content);
	return {
		type: "tool_result",
		tool_use_id: toolIds.get(message.toolCallId),
		content: content.length > 0 ? content : [{ type: "text", text: "(no output)" }],
		is_error: message.isError,
	};
}

export function toContentBlocks(content: string | (TextContent | ImageContent)[]): AnthropicBlock[] {
	if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
	return content
		.filter((block) => block.type !== "text" || block.text.length > 0)
		.map((block) =>
			block.type === "text"
				? { type: "text", text: block.text }
				: { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } },
		);
}

/** The Messages API requires alternating roles; Pi can have consecutive user or tool messages. */
function mergeConsecutiveRoles(entries: SessionEntry[]): SessionEntry[] {
	const merged: SessionEntry[] = [];
	for (const entry of entries) {
		const previous = merged[merged.length - 1];
		if (previous && previous.role === entry.role) {
			// Tool results must come first in a user turn.
			previous.content =
				entry.role === "user"
					? [
							...previous.content.filter((block) => block.type === "tool_result"),
							...entry.content.filter((block) => block.type === "tool_result"),
							...previous.content.filter((block) => block.type !== "tool_result"),
							...entry.content.filter((block) => block.type !== "tool_result"),
						]
					: [...previous.content, ...entry.content];
		} else {
			merged.push({ ...entry, content: [...entry.content] });
		}
	}
	return merged;
}

function isNonEmpty(entry: SessionEntry): boolean {
	return entry.content.length > 0;
}

/** Tool call ids from other providers may not match Anthropic's `^[a-zA-Z0-9_-]+$`. */
class ToolIdMap {
	private readonly ids = new Map<string, string>();

	get(piId: string): string {
		let anthropicId = this.ids.get(piId);
		if (!anthropicId) {
			anthropicId = /^[a-zA-Z0-9_-]{1,64}$/.test(piId) ? piId : `toolu_pi_${this.ids.size}_${piId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`;
			this.ids.set(piId, anthropicId);
		}
		return anthropicId;
	}
}
