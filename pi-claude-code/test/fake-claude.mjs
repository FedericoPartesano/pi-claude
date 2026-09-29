#!/usr/bin/env node
// Fake `claude -p` for bridge tests: speaks stream-json like Claude Code and calls the MCP
// endpoint from --mcp-config. Scenario per user turn:
//   text contains "READ:<path>"  -> assistant tool_use mcp__pi__read {path}, wait for MCP result,
//                                   then answer "FILE SAYS: <result>"
//   otherwise                    -> answer "ECHO: <text>"
import { readFileSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const argValue = (flag) => args[args.indexOf(flag) + 1];
const mcpUrl = JSON.parse(readFileSync(argValue("--mcp-config"), "utf8")).mcpServers.pi.url;
const logFile = process.env.FAKE_CLAUDE_LOG;
const log = (line) => logFile && appendFileSync(logFile, `${line}\n`);
log(`args ${JSON.stringify(args)}`);
log(`env ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? "<unset>"} MCP_TOOL_TIMEOUT=${process.env.MCP_TOOL_TIMEOUT}`);

const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const streamEvent = (event) => emit({ type: "stream_event", event, parent_tool_use_id: null, session_id: "fake" });
let messageCounter = 0;
let rpcId = 0;

async function mcp(method, params) {
	const response = await fetch(mcpUrl, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
		body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
	});
	return (await response.json()).result;
}

function streamText(text) {
	streamEvent({ type: "message_start", message: { id: `msg_${++messageCounter}`, model: "fake", usage: { input_tokens: 10, output_tokens: 0 } } });
	streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
	for (const piece of text.match(/.{1,5}/gs) ?? []) streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
	streamEvent({ type: "content_block_stop", index: 0 });
	streamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } });
	streamEvent({ type: "message_stop" });
}

// Like Claude Code when the model sends unparseable tool input: no MCP call, an error
// tool_result for the model, then the model retries with valid input.
async function badJsonThenRetry(path) {
	const badId = `toolu_${++messageCounter}`;
	streamEvent({ type: "message_start", message: { id: `msg_${messageCounter}`, model: "fake", usage: { input_tokens: 10, output_tokens: 0 } } });
	streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: badId, name: "mcp__pi__read", input: {} } });
	streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: `{"path": "${path}\t"}` } });
	streamEvent({ type: "content_block_stop", index: 0 });
	streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } });
	streamEvent({ type: "message_stop" });
	emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: badId, is_error: true, content: "<tool_use_error>InputValidationError: could not be parsed as JSON</tool_use_error>" }] } });
	log("bad json tool_use emitted, no MCP call");
}

async function handleTurn(text) {
	const badJsonMatch = /BADJSON:(\S+)/.exec(text);
	if (badJsonMatch) {
		await badJsonThenRetry(badJsonMatch[1]);
		text = `READ:${badJsonMatch[1]}`;
	}
	const readMatch = /READ:(\S+)/.exec(text);
	if (readMatch) {
		const toolUseId = `toolu_${++messageCounter}`;
		const input = { path: readMatch[1] };
		streamEvent({ type: "message_start", message: { id: `msg_${messageCounter}`, model: "fake", usage: { input_tokens: 10, output_tokens: 0 } } });
		streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: toolUseId, name: "mcp__pi__read", input: {} } });
		const json = JSON.stringify(input);
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(0, 8) } });
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(8) } });
		streamEvent({ type: "content_block_stop", index: 0 });
		streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } });
		streamEvent({ type: "message_stop" });
		const started = Date.now();
		const result = await mcp("tools/call", { name: "read", arguments: input });
		log(`tool result after ${Date.now() - started}ms: ${JSON.stringify(result).slice(0, 200)}`);
		emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: result.content }] } });
		streamText(`FILE SAYS: ${result.content.map((block) => block.text ?? "").join("").trim()}`);
	} else {
		streamText(`ECHO: ${text}`);
	}
	emit({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "fake" });
}

await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
const { tools } = await mcp("tools/list", {});
log(`tools ${tools.map((tool) => tool.name).join(",")}`);
emit({ type: "system", subtype: "init", tools: tools.map((tool) => `mcp__pi__${tool.name}`), apiKeySource: "none", session_id: "fake" });

let queue = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
	if (!line.trim()) return;
	const record = JSON.parse(line);
	const text = record.message.content.map((block) => block.text ?? "").join("\n");
	log(`user turn: ${text.slice(0, 300).replace(/\n/g, "\\n")}`);
	queue = queue.then(() => handleTurn(text));
});
