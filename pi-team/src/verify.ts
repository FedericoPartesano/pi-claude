/**
 * Runs verification commands. Verification is done by code, never by the agent, so a task
 * cannot be declared done while its checks fail.
 */
import { spawn } from "node:child_process";

export interface VerifyResult {
	command: string;
	ok: boolean;
	exitCode: number | null;
	/** Last part of stdout+stderr, enough to explain a failure to the agent. */
	outputTail: string;
	seconds: number;
}

const OUTPUT_TAIL_CHARS = 4000;

export function runVerifyCommand(command: string, cwd: string, timeoutMs = 300_000, signal?: AbortSignal): Promise<VerifyResult> {
	const started = Date.now();
	return new Promise((resolve) => {
		const child = spawn("bash", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		const collect = (chunk: Buffer) => (output = (output + chunk.toString("utf8")).slice(-OUTPUT_TAIL_CHARS * 2));
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		const timer = setTimeout(() => {
			output += `\n[timeout dopo ${timeoutMs / 1000}s]`;
			child.kill("SIGKILL");
		}, timeoutMs);
		const onAbort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("close", (exitCode) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({
				command,
				ok: exitCode === 0,
				exitCode,
				outputTail: output.slice(-OUTPUT_TAIL_CHARS),
				seconds: Math.round((Date.now() - started) / 100) / 10,
			});
		});
	});
}

export async function runVerifyCommands(commands: string[], cwd: string, signal?: AbortSignal): Promise<VerifyResult[]> {
	const results: VerifyResult[] = [];
	for (const command of commands) {
		const result = await runVerifyCommand(command, cwd, undefined, signal);
		results.push(result);
		if (!result.ok) break;
	}
	return results;
}
