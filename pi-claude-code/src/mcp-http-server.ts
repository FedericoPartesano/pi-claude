/**
 * Minimal MCP server (Streamable HTTP, JSON responses only) hosted inside the Pi process.
 *
 * Each Claude Code process gets its own endpoint path (`/mcp/<token>`), so tool lists and
 * tool-call routing stay isolated per bridge session. `tools/call` requests are handed to the
 * owning session, which keeps them pending until Pi has executed the tool.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface McpToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	_meta?: Record<string, unknown>;
}

export type McpContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface McpToolCallResult {
	content: McpContentBlock[];
	isError?: boolean;
}

export interface McpEndpointHandler {
	listTools(): McpToolDefinition[];
	callTool(name: string, toolArguments: Record<string, unknown>, signal: AbortSignal): Promise<McpToolCallResult>;
}

export interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
}

const SERVER_INFO = { name: "pi", version: "0.1.0" };
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export class McpHttpServer {
	private server: Server | undefined;
	private baseUrl: string | undefined;
	private readonly endpoints = new Map<string, McpEndpointHandler>();

	async start(): Promise<void> {
		if (this.server) return;
		const server = createServer((request, response) => {
			this.handleRequest(request, response).catch((error) => {
				if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
				response.end(String(error));
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("MCP server has no TCP address");
		this.server = server;
		this.baseUrl = `http://127.0.0.1:${address.port}`;
	}

	/** Registers a handler and returns the URL Claude Code must use to reach it. */
	registerEndpoint(handler: McpEndpointHandler): { url: string; dispose: () => void } {
		if (!this.baseUrl) throw new Error("MCP server not started");
		const token = randomBytes(16).toString("hex");
		this.endpoints.set(token, handler);
		return { url: `${this.baseUrl}/mcp/${token}`, dispose: () => this.endpoints.delete(token) };
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.baseUrl = undefined;
		this.endpoints.clear();
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const token = /^\/mcp\/([0-9a-f]+)$/.exec(request.url ?? "")?.[1];
		const handler = token ? this.endpoints.get(token) : undefined;
		if (!handler) {
			response.writeHead(404).end();
			return;
		}
		if (request.method === "DELETE") {
			response.writeHead(200).end();
			return;
		}
		if (request.method !== "POST") {
			// No server-initiated SSE stream: tell the client to rely on POST responses only.
			response.writeHead(405, { allow: "POST, DELETE" }).end();
			return;
		}

		const body = await readBody(request);
		const parsed = JSON.parse(body) as JsonRpcMessage | JsonRpcMessage[];
		const messages = Array.isArray(parsed) ? parsed : [parsed];

		// Abort pending tool calls if Claude Code drops the HTTP connection.
		const abortController = new AbortController();
		response.on("close", () => {
			if (!response.writableFinished) abortController.abort();
		});

		const replies = (
			await Promise.all(messages.map((message) => handleMcpMessage(handler, message, abortController.signal)))
		).filter((reply): reply is object => reply !== undefined);

		if (replies.length === 0) {
			response.writeHead(202).end();
			return;
		}
		if (response.destroyed) return;
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
	}
}

/** Answers one MCP JSON-RPC message for a handler; `undefined` for notifications. */
export async function handleMcpMessage(
	handler: McpEndpointHandler,
	message: JsonRpcMessage,
	signal: AbortSignal,
): Promise<object | undefined> {
	const isNotification = message.id === undefined || message.id === null;
	const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
	const replyError = (code: number, errorMessage: string) => ({
		jsonrpc: "2.0",
		id: message.id,
		error: { code, message: errorMessage },
	});

	switch (message.method) {
		case "initialize":
			return reply({
				protocolVersion: (message.params?.protocolVersion as string | undefined) ?? DEFAULT_PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
			});
		case "ping":
			return reply({});
		case "tools/list":
			return reply({ tools: handler.listTools() });
		case "tools/call": {
			const name = String(message.params?.name ?? "");
			const toolArguments = (message.params?.arguments ?? {}) as Record<string, unknown>;
			try {
				return reply(await handler.callTool(name, toolArguments, signal));
			} catch (error) {
				return reply({
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					isError: true,
				});
			}
		}
		default:
			return isNotification ? undefined : replyError(-32601, `Method not found: ${message.method}`);
	}
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}
