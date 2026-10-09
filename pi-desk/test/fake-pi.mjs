// A stand-in for `pi --mode rpc`: answers prompt, streams a delta containing U+2028, asks a confirm, settles.
let buffer = "";
const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let end;
	while ((end = buffer.indexOf("\n")) !== -1) {
		const command = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		if (command.type === "prompt") {
			out({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "started" } });
			out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `eco: ${command.message}   fine` } });
			out({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "pi-browser", message: "Aprire https://example.com?" });
		} else if (command.type === "extension_ui_response") {
			out({ type: "tool_execution_start", toolCallId: "t1", toolName: "browser", args: { action: "open", confirmed: command.confirmed } });
			out({ type: "agent_settled" });
		} else if (command.type === "get_state") out({ id: command.id, type: "response", command: "get_state", success: false, error: "non supportato" });
	}
});
