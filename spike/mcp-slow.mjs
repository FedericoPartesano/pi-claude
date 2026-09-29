// Spike: MCP stdio server that holds a tool call for DELAY_MS before answering.
// Verifies that Claude Code waits for a long-pending MCP call and then resumes.
import { readFileSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const DELAY_MS = Number(process.env.DELAY_MS ?? 30000);
const LOG_FILE = new URL("./spike.log", import.meta.url).pathname;
const log = (message) => appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);

const send = (payload) => process.stdout.write(JSON.stringify(payload) + "\n");

const tools = [
	{
		name: "read",
		description: "Read a text file.",
		inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
];

createInterface({ input: process.stdin }).on("line", async (line) => {
	if (!line.trim()) return;
	const request = JSON.parse(line);
	log(`<- ${request.method}`);
	switch (request.method) {
		case "initialize":
			send({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "pi", version: "0.0.1" },
				},
			});
			break;
		case "tools/list":
			send({ jsonrpc: "2.0", id: request.id, result: { tools } });
			break;
		case "tools/call": {
			const { name, arguments: toolArguments } = request.params;
			log(`tool call ${name} ${JSON.stringify(toolArguments)} — holding ${DELAY_MS}ms`);
			await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
			let text;
			try {
				text = readFileSync(toolArguments.path, "utf8");
			} catch (error) {
				text = `error: ${error.message}`;
			}
			log(`tool result released (${text.length} chars)`);
			send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text }] } });
			break;
		}
		default:
			if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, result: {} });
	}
});
