/**
 * `streamSimple` implementation backed by Claude Code sessions.
 *
 * Pi calls the provider once per assistant message with the whole transcript. We keep a small
 * pool of live Claude Code processes and pick the one whose already-known transcript is a prefix
 * of the incoming one, then only forward the new tail (tool results and/or user messages).
 * When nothing matches (first request, /tree, /fork, compaction, prompt, tool, model or thinking
 * level changes, aborts) a new process is started that natively resumes the transcript, written
 * as a Claude Code session file.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	collapseSystemMessages,
	createAssistantMessageEventStream,
	getCurrentSystemPrompt,
	getCurrentTools,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type TextContent,
	type ThinkingContent,
	type ThinkingLevel,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { ClaudeSession, type ClaudeRecord, MCP_TOOL_PREFIX } from "./claude-session.ts";
import { toContentBlocks, writeClaudeSession } from "./claude-transcript.ts";
import { McpHttpServer, type McpToolCallResult, type McpToolDefinition } from "./mcp-http-server.ts";
import type { RateLimitInfo } from "./footer.ts";

const MAX_LIVE_SESSIONS = 3;

/** Pi thinking level → Claude Code `--effort`. Pi's "off" arrives as no level (thinking disabled). */
const EFFORT_BY_THINKING_LEVEL: Record<ThinkingLevel, string> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

type ConversationMessage = Exclude<Message, { role: "system" }>;
type StreamingBlock = (TextContent | ThinkingContent | (ToolCall & { partialJson: string })) & { claudeIndex?: number };

const mcpServer = new McpHttpServer();
const liveSessions: ClaudeSession[] = [];

const debugLogPath = process.env.PI_CLAUDE_DEBUG;
const debugLog = debugLogPath
	? (line: string) => appendFileSync(debugLogPath, `${new Date().toISOString()} ${line}\n`)
	: undefined;

/**
 * Starts a Claude Code process ahead of the first request, so its cold start (several seconds)
 * overlaps with the user typing. It is used only if the first request has the same model,
 * effort, system prompt and tools; otherwise it is simply evicted from the pool later.
 */
export async function prewarmSession(modelId: string, thinkingLevel: string | undefined, systemPrompt: string, tools: Tool[]): Promise<void> {
	const effort = thinkingLevel && thinkingLevel !== "off" ? EFFORT_BY_THINKING_LEVEL[thinkingLevel as ThinkingLevel] : undefined;
	const signature = sessionSignature(modelId, effort, systemPrompt, tools);
	if (liveSessions.some((session) => session.isAlive && session.signature === signature && session.knownFingerprints.length === 0)) return;
	await mcpServer.start();
	debugLog?.(`prewarm ${modelId} effort=${effort ?? "off"} signature=${signature}`);
	const session = new ClaudeSession(signature, {
		claudeBinary: process.env.PI_CLAUDE_BINARY ?? "claude",
		model: modelId,
		systemPrompt,
		tools: tools.map(toMcpTool),
		cwd: process.cwd(),
		mcpServer,
		effort,
		debugLog,
		onRateLimit: recordRateLimit,
	});
	liveSessions.unshift(session);
	while (liveSessions.length > MAX_LIVE_SESSIONS) liveSessions.pop()?.dispose();
}

/** Tool order does not matter to the model; sort so prewarmed and real requests compare equal. */
function sessionSignature(modelId: string, effort: string | undefined, systemPrompt: string, tools: Tool[]): string {
	const sortedTools = tools.map(toMcpTool).sort((left, right) => left.name.localeCompare(right.name));
	return hash(JSON.stringify([modelId, effort, systemPrompt, sortedTools]));
}

let latestRateLimit: RateLimitInfo | undefined;
let subscriptionListener: ((info: RateLimitInfo) => void) | undefined;

/** Called with the latest usage whenever Claude Code reports subscription usage. */
export function onSubscriptionStatus(listener: (info: RateLimitInfo) => void): void {
	subscriptionListener = listener;
}

/** Shared with other extensions (e.g. pi-team budget) that need the subscription usage. */
const USAGE_FILE = join(homedir(), ".pi/agent/claude-code-usage.json");

function recordRateLimit(info: unknown): void {
	latestRateLimit = info as RateLimitInfo;
	subscriptionListener?.(latestRateLimit);
	try {
		mkdirSync(dirname(USAGE_FILE), { recursive: true });
		writeFileSync(
			USAGE_FILE,
			JSON.stringify({
				fiveHourUtilization: latestRateLimit.unifiedWindows?.five_hour?.utilization,
				sevenDayUtilization: latestRateLimit.unifiedWindows?.seven_day?.utilization,
				isUsingOverage: latestRateLimit.isUsingOverage ?? false,
				updatedAt: new Date().toISOString(),
			}),
		);
	} catch {
		// Usage sharing is best effort.
	}
}

export function disposeAllSessions(): void {
	for (const session of liveSessions.splice(0)) session.dispose();
	void mcpServer.stop();
}

export function streamClaudeCode(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};

	(async () => {
		let session: ClaudeSession | undefined;
		try {
			const transcript = collapseSystemMessages(context);
			const systemPrompt = getCurrentSystemPrompt(transcript.messages);
			const tools = getCurrentTools(transcript.messages);
			const conversation = transcript.messages.filter(
				(message): message is ConversationMessage => message.role !== "system",
			);
			const fingerprints = conversation.map(fingerprintMessage);
			const effort = options?.reasoning ? EFFORT_BY_THINKING_LEVEL[options.reasoning] : undefined;
			const signature = sessionSignature(model.id, effort, systemPrompt, tools);

			await mcpServer.start();
			session = findReusableSession(signature, conversation, fingerprints);
			debugLog?.(`request signature=${signature} reuse=${session ? `yes (known ${session.knownFingerprints.length})` : "no"}`);
			const newMessages = session ? conversation.slice(session.knownFingerprints.length) : conversation;
			await options?.onPayload?.({ reuse: session !== undefined, newMessages: newMessages.length }, model);

			if (session) {
				forwardNewMessages(session, newMessages);
			} else {
				session = startSessionFromTranscript(signature, model, effort, systemPrompt, tools, conversation);
			}
			session.knownFingerprints = fingerprints;

			stream.push({ type: "start", partial: output });
			await streamOneAssistantMessage(session, output, stream, tools, options?.signal);

			if (output.stopReason === "pending") throw new Error("Claude Code stream ended without a stop reason");
			session.knownFingerprints = [...fingerprints, fingerprintMessage(output)];
			stream.push({
				type: "done",
				reason: output.stopReason as Extract<StopReason, "stop" | "length" | "toolUse">,
				message: output,
			});
			stream.end();
		} catch (error) {
			if (session) discardSession(session);
			for (const block of output.content) {
				delete (block as StreamingBlock).claudeIndex;
				delete (block as { partialJson?: string }).partialJson;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

function findReusableSession(
	signature: string,
	conversation: ConversationMessage[],
	fingerprints: string[],
): ClaudeSession | undefined {
	for (const session of liveSessions) {
		if (!session.isAlive || session.signature !== signature) continue;
		const known = session.knownFingerprints;
		if (known.length >= fingerprints.length) continue;
		if (!known.every((fingerprint, index) => fingerprint === fingerprints[index])) continue;

		// The new tail may only contain tool results for calls this process is waiting on,
		// followed by user messages. Anything else means the histories diverged.
		const tail = conversation.slice(known.length);
		const firstUserIndex = tail.findIndex((message) => message.role !== "toolResult");
		const toolResults = firstUserIndex === -1 ? tail : tail.slice(0, firstUserIndex);
		const rest = firstUserIndex === -1 ? [] : tail.slice(firstUserIndex);
		if (!toolResults.every((message) => session.hasPendingToolCall((message as ToolResultMessage).toolCallId))) continue;
		if (!rest.every((message) => message.role === "user")) continue;

		// Most recently used first.
		liveSessions.splice(liveSessions.indexOf(session), 1);
		liveSessions.unshift(session);
		return session;
	}
	return undefined;
}

/**
 * Starts a Claude Code process for a transcript no live process knows. The history before the
 * trailing user messages is written as a Claude Code session and resumed natively; the trailing
 * user messages are then sent as the new turn.
 */
function startSessionFromTranscript(
	signature: string,
	model: Model<Api>,
	effort: string | undefined,
	systemPrompt: string,
	tools: Tool[],
	conversation: ConversationMessage[],
): ClaudeSession {
	let trailingUserStart = conversation.length;
	while (trailingUserStart > 0 && conversation[trailingUserStart - 1].role === "user") trailingUserStart--;
	const history = conversation.slice(0, trailingUserStart);
	const pendingUserMessages = conversation.slice(trailingUserStart) as Extract<ConversationMessage, { role: "user" }>[];

	const cwd = process.cwd();
	const resumeSession = history.length > 0 ? writeClaudeSession(history, cwd, model.id) : undefined;
	const session = new ClaudeSession(signature, {
		claudeBinary: process.env.PI_CLAUDE_BINARY ?? "claude",
		model: model.id,
		systemPrompt,
		tools: tools.map(toMcpTool),
		cwd,
		mcpServer,
		effort,
		resumeSessionId: resumeSession?.sessionId,
		onDispose: resumeSession?.dispose,
		debugLog,
		onRateLimit: recordRateLimit,
	});
	liveSessions.unshift(session);
	while (liveSessions.length > MAX_LIVE_SESSIONS) liveSessions.pop()?.dispose();

	if (pendingUserMessages.length > 0) {
		for (const message of pendingUserMessages) session.sendUserMessage(toContentBlocks(message.content));
	} else {
		// The transcript ends with tool results or an assistant message (retry after an error or
		// abort): ask the model to carry on from the resumed history.
		session.sendUserMessage([{ type: "text", text: "Continue." }]);
	}
	return session;
}

function discardSession(session: ClaudeSession): void {
	const index = liveSessions.indexOf(session);
	if (index !== -1) liveSessions.splice(index, 1);
	session.dispose();
}

/**
 * Tool results release the pending MCP calls. User messages that follow tool results are Pi
 * steering messages: they are written to stdin *before* the tool results are released, so
 * Claude Code sees them as real user messages queued during the run and picks them up
 * together with the tool results. (Embedding them in a tool result does not work: the model
 * rightly treats instructions inside tool output as possible prompt injection.)
 */
function forwardNewMessages(session: ClaudeSession, newMessages: ConversationMessage[]): void {
	const toolResults = newMessages.filter((message): message is ToolResultMessage => message.role === "toolResult");
	const userMessages = newMessages.filter(
		(message): message is Extract<ConversationMessage, { role: "user" }> => message.role === "user",
	);
	for (const message of userMessages) session.sendUserMessage(toContentBlocks(message.content));
	for (const message of toolResults) session.resolveToolCall(message.toolCallId, toMcpResult(message));
}

/** Reads Claude Code records until one assistant message has been streamed completely. */
async function streamOneAssistantMessage(
	session: ClaudeSession,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	tools: Tool[],
	signal: AbortSignal | undefined,
): Promise<void> {
	const blocks = output.content as StreamingBlock[];
	const piToolNames = new Set(tools.map((tool) => tool.name));
	let messageStarted = false;

	while (true) {
		const record: ClaudeRecord = await session.nextRecord(signal);
		if (signal?.aborted) throw new Error("Request was aborted");

		if (record.type === "result") {
			// A result closes a Claude Code run. Before our message starts it is either the
			// leftover of the previous run (ignore) or an error for this request.
			if (record.is_error === true || (record.subtype && record.subtype !== "success")) {
				throw new Error(describeResultError(record));
			}
			if (messageStarted) return;
			continue;
		}
		if (record.type !== "stream_event" || record.parent_tool_use_id) continue;

		const event = record.event as Record<string, any>;
		switch (event.type) {
			case "message_start":
				messageStarted = true;
				applyUsage(output, event.message?.usage);
				output.responseId = event.message?.id;
				if (event.message?.model) output.responseModel = event.message.model;
				break;
			case "content_block_start": {
				const contentBlock = event.content_block;
				if (contentBlock.type === "text") {
					blocks.push({ type: "text", text: "", claudeIndex: event.index });
					stream.push({ type: "text_start", contentIndex: blocks.length - 1, partial: output });
				} else if (contentBlock.type === "thinking") {
					blocks.push({
						type: "thinking",
						thinking: contentBlock.thinking ?? "",
						thinkingSignature: contentBlock.signature ?? "",
						claudeIndex: event.index,
					});
					stream.push({ type: "thinking_start", contentIndex: blocks.length - 1, partial: output });
				} else if (contentBlock.type === "redacted_thinking") {
					blocks.push({
						type: "thinking",
						thinking: "",
						thinkingSignature: contentBlock.data,
						redacted: true,
						claudeIndex: event.index,
					});
					stream.push({ type: "thinking_start", contentIndex: blocks.length - 1, partial: output });
				} else if (contentBlock.type === "tool_use") {
					blocks.push({
						type: "toolCall",
						id: contentBlock.id,
						name: String(contentBlock.name).replace(MCP_TOOL_PREFIX, ""),
						arguments: {},
						partialJson: "",
						claudeIndex: event.index,
					});
					stream.push({ type: "toolcall_start", contentIndex: blocks.length - 1, partial: output });
				}
				break;
			}
			case "content_block_delta": {
				const contentIndex = blocks.findIndex((block) => block.claudeIndex === event.index);
				const block = blocks[contentIndex];
				if (!block) break;
				const delta = event.delta;
				if (delta.type === "text_delta" && block.type === "text") {
					block.text += delta.text;
					stream.push({ type: "text_delta", contentIndex, delta: delta.text, partial: output });
				} else if (delta.type === "thinking_delta" && block.type === "thinking") {
					block.thinking += delta.thinking;
					stream.push({ type: "thinking_delta", contentIndex, delta: delta.thinking, partial: output });
				} else if (delta.type === "signature_delta" && block.type === "thinking") {
					block.thinkingSignature = (block.thinkingSignature ?? "") + delta.signature;
				} else if (delta.type === "input_json_delta" && block.type === "toolCall") {
					block.partialJson += delta.partial_json;
					try {
						block.arguments = JSON.parse(block.partialJson);
					} catch {
						// Incomplete JSON while streaming.
					}
					stream.push({ type: "toolcall_delta", contentIndex, delta: delta.partial_json, partial: output });
				}
				break;
			}
			case "content_block_stop": {
				const contentIndex = blocks.findIndex((block) => block.claudeIndex === event.index);
				const block = blocks[contentIndex];
				if (!block) break;
				delete block.claudeIndex;
				if (block.type === "text") {
					stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
				} else if (block.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
				} else if (block.type === "toolCall") {
					let parsed = true;
					if (block.partialJson) {
						try {
							block.arguments = JSON.parse(block.partialJson);
						} catch {
							// The model sent invalid JSON (e.g. raw tab characters inside strings). Claude
							// Code will not call the tool: it answers the model with an InputValidationError
							// and the model retries. Mirror that: hand Pi arguments that fail its validation,
							// and do not wait for an MCP call that will never come.
							parsed = false;
							block.arguments = { __unparsedToolInput: block.partialJson };
						}
					}
					delete (block as { partialJson?: string }).partialJson;
					if (piToolNames.has(block.name)) session.expectToolCall(block.id, block.name, block.arguments, { willBeCalled: parsed });
					stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				}
				break;
			}
			case "message_delta":
				if (event.delta?.stop_reason) output.stopReason = mapStopReason(event.delta.stop_reason);
				applyUsage(output, event.usage);
				break;
			case "message_stop":
				if (messageStarted) return;
				break;
		}
	}
}

function applyUsage(output: AssistantMessage, usage: Record<string, number> | undefined): void {
	if (!usage) return;
	if (usage.input_tokens !== undefined) output.usage.input = usage.input_tokens;
	if (usage.output_tokens !== undefined) output.usage.output = usage.output_tokens;
	if (usage.cache_read_input_tokens !== undefined) output.usage.cacheRead = usage.cache_read_input_tokens;
	if (usage.cache_creation_input_tokens !== undefined) output.usage.cacheWrite = usage.cache_creation_input_tokens;
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	// Subscription usage: no per-token cost.
}

function mapStopReason(reason: string): StopReason {
	switch (reason) {
		case "tool_use":
			return "toolUse";
		case "max_tokens":
			return "length";
		case "end_turn":
		case "stop_sequence":
		case "pause_turn":
			return "stop";
		default:
			return "error";
	}
}

function describeResultError(record: ClaudeRecord): string {
	const details = record.result ?? record.errors ?? record.subtype;
	return `Claude Code error: ${typeof details === "string" ? details : JSON.stringify(details)}`;
}

function toMcpTool(tool: Tool): McpToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>,
		_meta: {
			// Pi already truncates tool output; without this Claude Code moves large results to a
			// file and shows the model only a 2 KB preview.
			"anthropic/maxResultSizeChars": 10_000_000,
			// Never defer Pi's tools behind tool search.
			"anthropic/alwaysLoad": true,
		},
	};
}

function toMcpResult(message: ToolResultMessage): McpToolCallResult {
	const content = message.content.map((block) =>
		block.type === "text"
			? { type: "text" as const, text: block.text }
			: { type: "image" as const, data: block.data, mimeType: block.mimeType },
	);
	if (content.length === 0) content.push({ type: "text", text: "(no output)" });
	return { content, isError: message.isError };
}

function fingerprintMessage(message: ConversationMessage | AssistantMessage): string {
	switch (message.role) {
		case "user":
			return `user:${hash(JSON.stringify(message.content))}`;
		case "assistant": {
			const toolCallIds = message.content.filter((block) => block.type === "toolCall").map((block) => (block as ToolCall).id);
			const text = message.content
				.filter((block) => block.type === "text")
				.map((block) => (block as TextContent).text)
				.join("");
			return `assistant:${toolCallIds.join(",")}:${hash(text)}`;
		}
		case "toolResult":
			return `toolResult:${message.toolCallId}`;
	}
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
