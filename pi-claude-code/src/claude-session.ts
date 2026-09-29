/**
 * One long-lived `claude -p` process in stream-json mode, plus the MCP endpoint that exposes
 * Pi's tools to it.
 *
 * Claude Code runs the agent loop, but every tool it calls lands on our MCP endpoint and stays
 * pending until Pi has executed the tool itself (with all extension hooks) and hands the result
 * back through `resolveToolCall()`. Claude Code then continues, and its next assistant message
 * becomes the answer to Pi's next provider request. The two loops advance in lockstep.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	handleMcpMessage,
	type JsonRpcMessage,
	type McpEndpointHandler,
	type McpHttpServer,
	type McpToolCallResult,
	type McpToolDefinition,
} from "./mcp-http-server.ts";
import { ToolCallMatcher } from "./tool-call-matcher.ts";

export { stableStringify } from "./tool-call-matcher.ts";

export const MCP_SERVER_NAME = "pi";
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/**
 * How Pi's tools reach Claude Code:
 * - "sdk" (default): an SDK-hosted MCP server over the stream-json control channel (the Agent SDK
 *   protocol) with CLAUDE_AGENT_SDK_MCP_NO_PREFIX, so the model sees Pi's real tool names (read,
 *   edit, ...) exactly as Pi's system prompt names them.
 * - "http": a local HTTP MCP server; tools appear as mcp__pi__<name>.
 */
export const MCP_TRANSPORT: "sdk" | "http" = process.env.PI_CLAUDE_MCP_TRANSPORT === "http" ? "http" : "sdk";

/** The name Claude Code (and the model) uses for a Pi tool. */
export function claudeToolName(piToolName: string): string {
	return MCP_TRANSPORT === "sdk" ? piToolName : `${MCP_TOOL_PREFIX}${piToolName}`;
}

/** One JSON record printed by `claude --output-format stream-json`. */
export type ClaudeRecord = { type: string; subtype?: string; [key: string]: unknown };

export interface ClaudeSessionOptions {
	claudeBinary: string;
	model: string;
	systemPrompt: string;
	tools: McpToolDefinition[];
	cwd: string;
	mcpServer: McpHttpServer;
	/** Claude Code `--effort` level; `undefined` disables thinking. */
	effort?: string;
	/** Claude Code session id to `--resume` (a session file written from Pi's transcript). */
	resumeSessionId?: string;
	/** Called with every `rate_limit_event` record (subscription usage), whenever it arrives. */
	onRateLimit?: (info: unknown) => void;
	/** Called once the process no longer needs its resume file. */
	onDispose?: () => void;
	debugLog?: (line: string) => void;
}

// Environment variables that would make Claude Code bill an API key instead of the subscription.
const API_BILLING_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"];

export class ClaudeSession {
	/** Fingerprints of the transcript messages this process already knows, in order. */
	knownFingerprints: string[] = [];
	readonly signature: string;
	private readonly process: ChildProcessWithoutNullStreams;
	private readonly disposeEndpoint: () => void;
	private readonly mcpHandler: McpEndpointHandler;
	private readonly controlRequests = new Map<string, AbortController>();
	private readonly tempDirectory: string;
	private readonly records: ClaudeRecord[] = [];
	private recordWaiter: (() => void) | undefined;
	private readonly toolCalls: ToolCallMatcher;
	private exitError: Error | undefined;
	private stderrTail = "";

	constructor(
		signature: string,
		private readonly options: ClaudeSessionOptions,
	) {
		this.signature = signature;
		this.toolCalls = new ToolCallMatcher({ debugLog: options.debugLog });
		this.mcpHandler = {
			listTools: () => options.tools,
			callTool: (name, toolArguments, signal) => this.handleMcpToolCall(name, toolArguments, signal),
		};
		const endpoint = MCP_TRANSPORT === "http" ? options.mcpServer.registerEndpoint(this.mcpHandler) : undefined;
		this.disposeEndpoint = endpoint?.dispose ?? (() => {});

		this.tempDirectory = mkdtempSync(join(tmpdir(), "pi-claude-code-"));
		const systemPromptFile = join(this.tempDirectory, "system-prompt.md");
		const mcpConfigFile = join(this.tempDirectory, "mcp.json");
		writeFileSync(systemPromptFile, options.systemPrompt + toolNameNote(options.tools));
		writeFileSync(
			mcpConfigFile,
			JSON.stringify({
				mcpServers: {
					[MCP_SERVER_NAME]: endpoint ? { type: "http", url: endpoint.url } : { type: "sdk", name: MCP_SERVER_NAME },
				},
			}),
		);

		const args = [
			"-p",
			"--input-format", "stream-json",
			"--output-format", "stream-json",
			"--verbose",
			"--include-partial-messages",
			"--model", options.model,
			"--system-prompt-file", systemPromptFile,
			"--tools", "",
			"--mcp-config", mcpConfigFile,
			"--strict-mcp-config",
			// Permission rules use the internal MCP name even when the model sees unprefixed names.
			"--allowedTools", `mcp__${MCP_SERVER_NAME}`,
			"--setting-sources", "",
			// Stream thinking summaries (default is "omitted": empty thinking text) so Pi can render them.
			"--thinking-display", "summarized",
			"--disable-slash-commands",
			// Pi owns the session history; Claude Code keeps nothing on disk.
			"--no-session-persistence",
			...(options.effort ? ["--effort", options.effort] : []),
			...(options.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
		];

		const environment: NodeJS.ProcessEnv = {
			...process.env,
			// Pi may take a long time to run a tool (long bash commands, user confirmations).
			MCP_TOOL_TIMEOUT: "86400000",
			// Pi already truncates tool output; do not let Claude Code truncate it again.
			MAX_MCP_OUTPUT_TOKENS: "200000",
			// Keep the model context equal to Pi's: no Claude Code reminders (environment, model,
			// date, token budget, user context), no CLAUDE.md, memory, git or skill injection.
			// `--bare` would do more but switches auth to API keys, so it must not be used.
			CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
			CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
			CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
			CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
			CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
			CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: "1",
			// Pi owns compaction.
			DISABLE_AUTO_COMPACT: "1",
			...(MCP_TRANSPORT === "sdk" ? { CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1" } : {}),
			...(options.effort ? {} : { CLAUDE_CODE_DISABLE_THINKING: "1" }),
		};
		for (const name of API_BILLING_ENV) delete environment[name];

		options.debugLog?.(`spawn ${options.claudeBinary} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
		this.process = spawn(options.claudeBinary, args, { cwd: options.cwd, env: environment, stdio: "pipe" });

		createInterface({ input: this.process.stdout }).on("line", (line) => {
			if (!line.trim()) return;
			options.debugLog?.(`<- ${line.slice(0, 500)}`);
			let record: ClaudeRecord;
			try {
				record = JSON.parse(line) as ClaudeRecord;
			} catch {
				return;
			}
			if (record.type === "control_request") {
				void this.handleControlRequest(record);
				return;
			}
			if (record.type === "control_cancel_request") {
				this.controlRequests.get(String(record.request_id))?.abort();
				return;
			}
			if (record.type === "control_response") return;
			if (record.type === "rate_limit_event") {
				options.onRateLimit?.(record.rate_limit_info);
				return;
			}
			this.records.push(record);
			this.wakeReader();
		});
		if (MCP_TRANSPORT === "sdk") {
			// Declare the SDK-hosted server before the first user message.
			this.writeRecord({
				type: "control_request",
				request_id: "pi-initialize",
				request: {
					subtype: "initialize",
					sdkMcpServers: [MCP_SERVER_NAME],
					sdkMcpServerConfigs: { [MCP_SERVER_NAME]: { timeout: 86_400_000 } },
				},
			});
		}
		this.process.stderr.on("data", (chunk: Buffer) => {
			this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000);
		});
		this.process.on("error", (error) => this.markExited(error));
		this.process.on("exit", (code, signal) =>
			this.markExited(
				new Error(
					`claude exited (code ${code ?? "none"}, signal ${signal ?? "none"})${this.stderrTail ? `: ${this.stderrTail.trim()}` : ""}`,
				),
			),
		);
	}

	get isAlive(): boolean {
		return this.exitError === undefined;
	}

	/** Sends a user turn. `content` uses Anthropic Messages content blocks. */
	sendUserMessage(content: unknown[]): void {
		this.writeRecord({ type: "user", message: { role: "user", content } });
	}

	private writeRecord(record: unknown): void {
		this.options.debugLog?.(`-> ${JSON.stringify(record).slice(0, 500)}`);
		if (!this.process.stdin.destroyed) this.process.stdin.write(`${JSON.stringify(record)}\n`);
	}

	/** Control requests from Claude Code: MCP messages for the SDK-hosted server. */
	private async handleControlRequest(record: ClaudeRecord): Promise<void> {
		const requestId = String(record.request_id);
		const request = record.request as { subtype?: string; server_name?: string; message?: JsonRpcMessage } | undefined;
		if (request?.subtype !== "mcp_message" || request.server_name !== MCP_SERVER_NAME || !request.message) {
			this.writeRecord({
				type: "control_response",
				response: { subtype: "error", request_id: requestId, error: `Unsupported control request: ${request?.subtype}` },
			});
			return;
		}
		const abortController = new AbortController();
		this.controlRequests.set(requestId, abortController);
		try {
			const reply = await handleMcpMessage(this.mcpHandler, request.message, abortController.signal);
			this.writeRecord({
				type: "control_response",
				response: {
					subtype: "success",
					request_id: requestId,
					// Notifications have no reply; acknowledge them like the Agent SDK does.
					response: { mcp_response: reply ?? { jsonrpc: "2.0", result: {}, id: 0 } },
				},
			});
		} catch (error) {
			this.writeRecord({
				type: "control_response",
				response: { subtype: "error", request_id: requestId, error: error instanceof Error ? error.message : String(error) },
			});
		} finally {
			this.controlRequests.delete(requestId);
		}
	}

	/**
	 * Called while streaming: a tool_use block finished. Normally Claude Code is about to call it
	 * through MCP (or already has: see `ToolCallMatcher`); with `willBeCalled: false` (unparseable
	 * input) Claude Code answers the model itself, so Pi's result for that call is only acknowledged.
	 */
	expectToolCall(id: string, name: string, toolArguments: unknown, { willBeCalled = true } = {}): void {
		this.toolCalls.expect(id, name, toolArguments, { willBeCalled });
	}

	/** Pi has executed the tool: release the pending MCP request (or store the result for it). */
	resolveToolCall(id: string, result: McpToolCallResult): boolean {
		return this.toolCalls.resolve(id, result);
	}

	hasPendingToolCall(id: string): boolean {
		return this.toolCalls.has(id);
	}

	/** Returns the next stdout record, waiting if necessary. */
	async nextRecord(signal?: AbortSignal): Promise<ClaudeRecord> {
		while (this.records.length === 0) {
			if (this.exitError) throw this.exitError;
			if (signal?.aborted) throw new Error("Request was aborted");
			await new Promise<void>((resolve) => {
				const onAbort = () => resolve();
				this.recordWaiter = () => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				};
				signal?.addEventListener("abort", onAbort, { once: true });
			});
			this.recordWaiter = undefined;
		}
		return this.records.shift()!;
	}

	dispose(): void {
		this.markExited(new Error("claude session disposed"));
		if (this.process.exitCode === null && !this.process.killed) this.process.kill("SIGTERM");
		this.disposeEndpoint();
		rmSync(this.tempDirectory, { recursive: true, force: true });
		this.options.onDispose?.();
	}

	private handleMcpToolCall(
		name: string,
		toolArguments: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<McpToolCallResult> {
		return this.toolCalls.handleCall(name, toolArguments, signal);
	}

	private markExited(error: Error): void {
		if (this.exitError) return;
		this.exitError = error;
		this.options.debugLog?.(`session ended: ${error.message}`);
		this.toolCalls.failAll(error);
		this.wakeReader();
	}

	private wakeReader(): void {
		this.recordWaiter?.();
	}
}

/**
 * Pi's prompt names its tools (read, edit, ...) but Claude Code exposes them as mcp__pi__<name>.
 * Experimental (PI_CLAUDE_TOOL_NOTE=1): tell the model the mapping.
 */
function toolNameNote(tools: McpToolDefinition[]): string {
	if (MCP_TRANSPORT === "sdk" || process.env.PI_CLAUDE_TOOL_NOTE !== "1" || tools.length === 0) return "";
	const mapping = tools.map((tool) => `${tool.name} = ${MCP_TOOL_PREFIX}${tool.name}`).join(", ");
	return `\n\nThe tools named above are available with these exact names: ${mapping}. Prefer them over bash equivalents as instructed.`;
}

