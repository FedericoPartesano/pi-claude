// Drivers that run a multi-turn conversation against Claude Code (native) or Pi (claude-code
// bridge) inside a working directory, and collect per-turn metrics.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const TURN_TIMEOUT_MS = Number(process.env.EVAL_TURN_TIMEOUT_MS ?? 300_000);

// Commands Claude Code may run without a prompt. Pi runs anything (YOLO + user hooks).
const CLAUDE_ALLOWED_TOOLS = [
	"Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit",
	"Bash(npm:*)", "Bash(node:*)", "Bash(python3:*)", "Bash(git:*)", "Bash(ls:*)", "Bash(cat:*)",
	"Bash(grep:*)", "Bash(wc:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(sort:*)", "Bash(uniq:*)",
	"Bash(find:*)", "Bash(du:*)", "Bash(awk:*)", "Bash(sed:*)", "Bash(cut:*)", "Bash(echo:*)",
	"Bash(mkdir:*)", "Bash(cp:*)", "Bash(mv:*)", "Bash(touch:*)", "Bash(diff:*)", "Bash(jq:*)",
];

class JsonLineProcess {
	constructor(command, args, cwd, environment = {}) {
		this.child = spawn(command, args, { cwd, env: { ...process.env, ...environment }, stdio: ["pipe", "pipe", "pipe"] });
		this.listeners = new Set();
		this.stderr = "";
		this.exited = false;
		createInterface({ input: this.child.stdout }).on("line", (line) => {
			let record;
			try {
				record = JSON.parse(line);
			} catch {
				return;
			}
			for (const listener of this.listeners) listener(record);
		});
		this.child.stderr.on("data", (chunk) => (this.stderr = (this.stderr + chunk).slice(-3000)));
		this.child.on("exit", () => {
			this.exited = true;
			for (const listener of this.listeners) listener({ type: "__exit__" });
		});
	}
	send(record) {
		if (!this.exited) this.child.stdin.write(`${JSON.stringify(record)}\n`);
	}
	kill() {
		if (!this.exited) this.child.kill("SIGTERM");
	}
}

function emptyTurn(prompt) {
	return { prompt, answer: "", seconds: 0, requests: 0, inputTokens: 0, outputTokens: 0, tools: [], errors: [], denials: 0, timedOut: false };
}

/**
 * End of a Claude Code turn. Streamed assistant messages carry partial usage (output_tokens 1 while streaming); the
 * result record has the turn totals, so they replace the streamed counts when present.
 */
export function applyClaudeResult(turn, record) {
	turn.answer = record.result ?? "";
	if (record.is_error) turn.errors.push(`result error: ${record.subtype} ${String(record.result ?? "").slice(0, 200)}`);
	turn.denials = record.permission_denials?.length ?? 0;
	const usage = record.usage;
	if (usage) {
		turn.inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
		turn.outputTokens = usage.output_tokens ?? 0;
	}
}

export class ClaudeCodeHarness {
	name = "claude-code";
	constructor(cwd, model, { effort } = {}) {
		this.process = new JsonLineProcess(
			"claude",
			[
				"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
				"--model", model, "--no-session-persistence",
				"--permission-mode", "acceptEdits", "--allowedTools", CLAUDE_ALLOWED_TOOLS.join(","),
				...(effort ? ["--effort", effort] : []),
			],
			cwd,
		);
	}
	runTurn(prompt) {
		const turn = emptyTurn(prompt);
		const started = Date.now();
		const seenMessages = new Set();
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				this.process.listeners.delete(listener);
				turn.seconds = Math.round((Date.now() - started) / 100) / 10;
				resolve(turn);
			};
			const timer = setTimeout(() => {
				turn.timedOut = true;
				this.process.send({ type: "control_request", request_id: "interrupt", request: { subtype: "interrupt" } });
				finish();
			}, TURN_TIMEOUT_MS);
			const listener = (record) => {
				if (record.type === "__exit__") {
					turn.errors.push(`process exited: ${this.process.stderr.slice(-300)}`);
					return finish();
				}
				if (record.type === "assistant" && record.message) {
					if (!seenMessages.has(record.message.id)) {
						seenMessages.add(record.message.id);
						const usage = record.message.usage ?? {};
						turn.requests++;
						turn.inputTokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
						turn.outputTokens += usage.output_tokens ?? 0;
					}
					for (const block of record.message.content ?? []) if (block.type === "tool_use") turn.tools.push(block.name);
				}
				if (record.type === "result") {
					applyClaudeResult(turn, record);
					finish();
				}
			};
			this.process.listeners.add(listener);
			this.process.send({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
		});
	}
	close() {
		this.process.kill();
	}
}

/** Pi's RPC arguments; persistSession saves the session where Pi normally does (for /dream). */
export function piArgs(model, { extraArgs = [], persistSession = false } = {}) {
	return ["--mode", "rpc", ...(persistSession ? [] : ["--no-session"]), "--provider", "claude-code", "--model", model, ...(process.env.EVAL_PI_THINKING ? ["--thinking", process.env.EVAL_PI_THINKING] : []), ...extraArgs];
}

export class PiHarness {
	name = "pi";
	constructor(cwd, model, debugLogPath, { extraArgs = [], environment = {}, persistSession = false } = {}) {
		this.dialogs = 0;
		this.process = new JsonLineProcess(
			"pi",
			piArgs(model, { extraArgs, persistSession }),
			cwd,
			{ ...(debugLogPath ? { PI_CLAUDE_DEBUG: debugLogPath } : {}), ...environment },
		);
		// Hooks asking for confirmation (permission-gate): answer "cancel", the safe choice.
		this.process.listeners.add((record) => {
			if (record.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(record.method)) {
				this.dialogs++;
				this.process.send({ type: "extension_ui_response", id: record.id, cancelled: true });
			}
		});
	}
	runTurn(prompt) {
		const turn = emptyTurn(prompt);
		const started = Date.now();
		const dialogsBefore = this.dialogs;
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				this.process.listeners.delete(listener);
				turn.denials = this.dialogs - dialogsBefore;
				turn.seconds = Math.round((Date.now() - started) / 100) / 10;
				resolve(turn);
			};
			const timer = setTimeout(() => {
				turn.timedOut = true;
				this.process.send({ type: "abort" });
				setTimeout(finish, 3000);
			}, TURN_TIMEOUT_MS);
			const listener = (record) => {
				if (record.type === "__exit__") {
					turn.errors.push(`process exited: ${this.process.stderr.slice(-300)}`);
					return finish();
				}
				if (record.type === "message_end" && record.message?.role === "assistant") {
					const message = record.message;
					turn.requests++;
					turn.inputTokens += (message.usage?.input ?? 0) + (message.usage?.cacheRead ?? 0) + (message.usage?.cacheWrite ?? 0);
					turn.outputTokens += message.usage?.output ?? 0;
					const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
					if (text) turn.answer = text;
					if (message.errorMessage) turn.errors.push(`[${message.stopReason}] ${message.errorMessage}`);
				}
				if (record.type === "tool_execution_start") turn.tools.push(record.toolName);
				if (record.type === "tool_execution_end" && record.toolName === "team") {
					turn.teamReport = (record.result?.content ?? []).map((block) => block.text ?? "").join("");
				}
				if (record.type === "response" && record.success === false) turn.errors.push(`rpc: ${record.error}`);
				if (record.type === "agent_settled") finish();
			};
			this.process.listeners.add(listener);
			this.process.send({ type: "prompt", message: prompt });
		});
	}
	close() {
		this.process.kill();
	}
}
