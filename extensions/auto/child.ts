/**
 * One auto mode step = one child `pi` in JSON mode, cwd = worktree, with only the Claude Code provider and the
 * auto worker loaded (`--no-extensions`: 4 554 prompt tokens per turn instead of 23 906, measured M1). The child
 * runs in its own process group: on timeout, stop or Pi exit the whole group is killed, so no orphan keeps
 * writing in the worktree.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { StepRequest, StepResult } from "./loop.ts";
import type { AutoState } from "./state.ts";

export const STEP_TIMEOUT_MS = Number(process.env.PI_AUTO_STEP_MINUTES ?? 20) * 60_000;
export const WORKER_PATH = fileURLToPath(new URL("../auto-worker.ts", import.meta.url));
export const PROVIDER_PATH = fileURLToPath(new URL("../../pi-claude-code/index.ts", import.meta.url));
const TOOLS = "read,bash,edit,write";

export interface ChildEnv {
	gitDir: string;
	skillsDir: string;
}

export function childArgs(state: AutoState, request: StepRequest): string[] {
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "-e", PROVIDER_PATH, "-e", WORKER_PATH, "--no-skills", "--tools", TOOLS];
	if (state.model) args.push("--provider", state.model.provider, "--model", state.model.id);
	args.push(request.prompt);
	return args;
}

export function childEnv(state: AutoState, request: StepRequest, env: ChildEnv): NodeJS.ProcessEnv {
	return {
		...process.env,
		PI_AUTO_PHASE: request.phase,
		PI_AUTO_WORKTREE: state.worktree,
		PI_AUTO_GIT_DIR: env.gitDir,
		PI_AUTO_FROZEN: JSON.stringify(state.frozen),
		PI_AUTO_READONLY: JSON.stringify(request.readOnly),
		PI_AUTO_SKILLS: env.skillsDir,
		PI_TEAM_CHILD: "1",
	};
}

/** Kills the child's whole process group (bash, bwrap, test runners it started). */
export function killGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
	if (child.pid === undefined || child.exitCode !== null) return;
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {}
	}
}

const running = new Set<ChildProcess>();

/** Called on session shutdown: no child survives the supervisor. */
export function killAllChildren(): void {
	for (const child of running) {
		killGroup(child, "SIGTERM");
		setTimeout(() => killGroup(child, "SIGKILL"), 3000).unref();
	}
}

export function runChild(state: AutoState, request: StepRequest, env: ChildEnv, signal?: AbortSignal, timeoutMs = STEP_TIMEOUT_MS): Promise<StepResult> {
	const result: StepResult = { ok: false, text: "", tokens: 0 };
	return new Promise((resolve) => {
		const child = spawn(process.env.PI_AUTO_PI_BINARY ?? "pi", childArgs(state, request), {
			cwd: state.worktree,
			env: childEnv(state, request, env),
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		running.add(child);
		let stderrTail = "";
		child.stderr?.on("data", (chunk: Buffer) => (stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000)));
		createInterface({ input: child.stdout! }).on("line", (line) => {
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type !== "message_end" || event.message?.role !== "assistant") return;
			const usage = event.message.usage ?? {};
			result.tokens += (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0);
			const text = (event.message.content ?? []).filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
			if (text) result.text = text;
			if (event.message.errorMessage) result.error = event.message.errorMessage;
		});
		const timer = setTimeout(() => {
			result.error = `timeout dopo ${Math.round(timeoutMs / 60_000)} minuti`;
			killGroup(child);
		}, timeoutMs);
		const onAbort = () => {
			result.error = "fermato";
			killGroup(child);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", (error) => {
			result.error = error.message;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			running.delete(child);
			signal?.removeEventListener("abort", onAbort);
			// Leftovers of the group (a server started in background) go with the step.
			if (child.pid !== undefined)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			if (code !== 0 && !result.error) result.error = `pi è uscito con codice ${code}: ${stderrTail.trim().slice(-300)}`;
			result.ok = !result.error;
			resolve(result);
		});
	});
}
