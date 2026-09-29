/**
 * Runs one team agent as a child `pi` process in JSON mode with the role's model, thinking level,
 * tool allowlist and instructions, and collects its final answer and usage.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Role } from "./roles.ts";

export interface AgentRun {
	ok: boolean;
	text: string;
	inputTokens: number;
	outputTokens: number;
	requests: number;
	seconds: number;
	error?: string;
}

export interface AgentRequest {
	role: Role;
	prompt: string;
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export type RunAgent = (request: AgentRequest) => Promise<AgentRun>;

/** Set in child processes so a team agent never loads the team tool itself. */
export const CHILD_ENVIRONMENT_FLAG = "PI_TEAM_CHILD";

export const runAgent: RunAgent = ({ role, prompt, cwd, signal, timeoutMs = 20 * 60_000 }) => {
	const started = Date.now();
	const run: AgentRun = { ok: false, text: "", inputTokens: 0, outputTokens: 0, requests: 0, seconds: 0 };
	const args = [
		"--mode", "json", "-p", "--no-session",
		"--provider", "claude-code", "--model", role.model,
		"--thinking", role.thinking,
		"--tools", role.tools.join(","),
		"--append-system-prompt", `# Ruolo nel team: ${role.name}\n\n${role.instructions}`,
		prompt,
	];
	return new Promise((resolve) => {
		const child = spawn(process.env.PI_TEAM_PI_BINARY ?? "pi", args, {
			cwd,
			env: { ...process.env, [CHILD_ENVIRONMENT_FLAG]: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderrTail = "";
		child.stderr.on("data", (chunk: Buffer) => (stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000)));
		createInterface({ input: child.stdout }).on("line", (line) => {
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type === "message_end" && event.message?.role === "assistant") {
				const message = event.message;
				run.requests++;
				run.inputTokens += (message.usage?.input ?? 0) + (message.usage?.cacheRead ?? 0) + (message.usage?.cacheWrite ?? 0);
				run.outputTokens += message.usage?.output ?? 0;
				const text = (message.content ?? []).filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
				if (text) run.text = text;
				if (message.errorMessage) run.error = message.errorMessage;
			}
		});
		const timer = setTimeout(() => {
			run.error = `timeout dopo ${Math.round(timeoutMs / 60_000)} minuti`;
			child.kill("SIGTERM");
		}, timeoutMs);
		const onAbort = () => {
			run.error = "interrotto";
			child.kill("SIGTERM");
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("close", (exitCode) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (exitCode !== 0 && !run.error) run.error = `pi è uscito con codice ${exitCode}: ${stderrTail.trim().slice(-300)}`;
			run.ok = !run.error && run.text.length > 0;
			run.seconds = Math.round((Date.now() - started) / 100) / 10;
			resolve(run);
		});
	});
};
