/**
 * Minimal MCP client for Micelio over streamable HTTP (initialize → tools/call). The address and the auth header come from
 * Pi's own MCP config (`mcpServers.micelio` in ~/.pi/agent/mcp.json); the header is only sent, never printed or logged.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeRpcReply } from "./memories.ts";

export interface MicelioConfig {
	url: string;
	headers: Record<string, string>;
}

export const MCP_CONFIG = join(homedir(), ".pi", "agent", "mcp.json");

export function loadMicelioConfig(file = MCP_CONFIG): MicelioConfig | undefined {
	try {
		const server = (JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }> }).mcpServers?.micelio;
		return server?.url ? { url: server.url, headers: server.headers ?? {} } : undefined;
	} catch {
		return undefined;
	}
}

export class MicelioClient {
	private sessionId: string | undefined;
	private nextId = 1;
	private readonly config: MicelioConfig;
	private readonly fetcher: typeof fetch;

	constructor(config: MicelioConfig, fetcher: typeof fetch = fetch) {
		this.config = config;
		this.fetcher = fetcher;
	}

	private async post(body: unknown, signal?: AbortSignal): Promise<{ reply: unknown; response: Response }> {
		const response = await this.fetcher(this.config.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...this.config.headers,
				...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
			},
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok) throw new Error(`Micelio ha risposto ${response.status}`);
		const text = await response.text();
		return { reply: text ? decodeRpcReply(response.headers.get("content-type") ?? "", text) : undefined, response };
	}

	private async start(signal?: AbortSignal): Promise<void> {
		const { response } = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pi-claude-micelio", version: "0.1.0" } } }, signal);
		this.sessionId = response.headers.get("mcp-session-id") ?? undefined;
		await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, signal);
	}

	/** The text `recall` returns for `query`. The session opens on first use and once more if the server dropped it. */
	async recall(query: string, limit = 8, signal?: AbortSignal): Promise<string> {
		const call = async (): Promise<string> => {
			if (!this.sessionId) await this.start(signal);
			const { reply } = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name: "recall", arguments: { query, limit } } }, signal);
			const message = reply as { error?: { message?: string }; result?: { isError?: boolean; content?: { type: string; text?: string }[] } };
			if (message.error) throw new Error(message.error.message ?? "errore MCP");
			if (message.result?.isError) throw new Error("recall ha restituito un errore");
			return (message.result?.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
		};
		try {
			return await call();
		} catch (error) {
			if (signal?.aborted) throw error;
			this.sessionId = undefined;
			return call();
		}
	}
}
