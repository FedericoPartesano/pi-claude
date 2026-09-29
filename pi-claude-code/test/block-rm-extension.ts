/**
 * Test extension: blocks any bash command containing `rm ` through Pi's `tool_call` hook.
 * Used to verify that extension hooks still run when the model is served by pi-claude-code.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const command = String((event.input as { command?: string }).command ?? "");
		if (/\brm\s/.test(command)) {
			return { block: true, reason: "BLOCKED_BY_PI_EXTENSION: rm is not allowed in this session" };
		}
	});
}
