/**
 * One auto mode step = one child `pi` in JSON mode, cwd = worktree, with only the Claude Code provider and the
 * auto worker loaded (`--no-extensions`: 4 554 prompt tokens per turn instead of 23 906, measured M1); Pi's own
 * extensions (browser, jobs, lean-tools, graph) are added only for the steps that need them (auto/tools.ts). The child
 * runs in its own process group: on timeout, stop or Pi exit the whole group is killed, so no orphan keeps
 * writing in the worktree.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { toolArg } from "./diary.ts";
import type { StepRequest, StepResult } from "./loop.ts";
import { selectSkills, skillName, type SkillSet, type StepKind } from "./skills.ts";
import type { AutoState } from "./state.ts";
import { buildStaticGraph, chooseTools, codeFiles, toolsFor, type StepTools } from "./tools.ts";

export const STEP_TIMEOUT_MS = Number(process.env.PI_AUTO_STEP_MINUTES ?? 20) * 60_000;
export const WORKER_PATH = fileURLToPath(new URL("../auto-worker.ts", import.meta.url));
export const PROVIDER_PATH = fileURLToPath(new URL("../../pi-claude-code/index.ts", import.meta.url));
const TOOLS = "read,bash,edit,write";
const BASIC = new Set(TOOLS.split(","));

export interface ChildEnv {
	gitDir: string;
	skillsDir: string;
	/** Every tool call of the child (cockpit diary): name and short argument. */
	onTool?: (name: string, arg: string) => void;
}

const NO_TOOLS: StepTools = toolsFor([]);

/** Extra tools of the step (auto/tools.ts), from the same kinds and context as the skills. */
export function stepTools(state: AutoState, request: StepRequest): StepTools {
	const kinds = request.skills?.kinds ?? [request.phase as StepKind];
	return toolsFor(chooseTools(kinds, request.skills?.context ?? state.goal, codeFiles(state.worktree)));
}

export function childArgs(state: AutoState, request: StepRequest, tools: StepTools = NO_TOOLS): string[] {
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "-e", PROVIDER_PATH, "-e", WORKER_PATH];
	for (const path of tools.extensions) args.push("-e", path);
	args.push("--no-skills", "--tools", [TOOLS, ...tools.names].join(","));
	if (state.model) args.push("--provider", state.model.provider, "--model", state.model.id);
	args.push(request.prompt);
	return args;
}

export function stepSkills(state: AutoState, request: StepRequest, env: ChildEnv): SkillSet {
	return selectSkills(env.skillsDir, request.skills?.kinds ?? [request.phase as StepKind], request.skills?.context ?? state.goal);
}

export function childEnv(state: AutoState, request: StepRequest, env: ChildEnv, tools: StepTools = NO_TOOLS): NodeJS.ProcessEnv {
	return {
		...process.env,
		...tools.env,
		PI_AUTO_TOOLS: JSON.stringify(tools.groups),
		PI_AUTO_LOCALNET: tools.localNetwork ? "1" : "0",
		PI_AUTO_PHASE: request.phase,
		PI_AUTO_WORKTREE: state.worktree,
		PI_AUTO_GIT_DIR: env.gitDir,
		PI_AUTO_FROZEN: JSON.stringify(state.frozen),
		PI_AUTO_READONLY: JSON.stringify(request.readOnly),
		PI_AUTO_SKILLS: env.skillsDir,
		PI_AUTO_SKILL_SET: JSON.stringify(stepSkills(state, request, env)),
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

export async function runChild(state: AutoState, request: StepRequest, env: ChildEnv, signal?: AbortSignal, timeoutMs = STEP_TIMEOUT_MS): Promise<StepResult> {
	const tools = stepTools(state, request);
	if (tools.groups.includes("graph")) await buildStaticGraph(state.worktree).catch(() => undefined);
	const result: StepResult = { ok: false, text: "", tokens: 0, skillsGiven: stepSkills(state, request, env).inline.map(skillName), skillsRead: [], toolsGiven: tools.groups, toolsUsed: [] };
	return new Promise((resolve) => {
		const child = spawn(process.env.PI_AUTO_PI_BINARY ?? "pi", childArgs(state, request, tools), {
			cwd: state.worktree,
			env: childEnv(state, request, env, tools),
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		running.add(child);
		let stderrTail = "";
		let settled: NodeJS.Timeout | undefined;
		child.stderr?.on("data", (chunk: Buffer) => (stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000)));
		createInterface({ input: child.stdout! }).on("line", (line) => {
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			// The step is over, but an extension may keep Pi's event loop alive (a browser, a job timer): print mode only
			// exits when it drains. Seen once in a real browser step: Pi idle until the 20-minute timeout.
			if (event.type === "agent_settled" && !settled) {
				settled = setTimeout(() => killGroup(child), Number(process.env.PI_AUTO_SETTLE_MS) || 15_000);
				return;
			}
			if (event.type === "tool_execution_start") env.onTool?.(String(event.toolName), toolArg(event.args));
			if (event.type === "tool_execution_start" && !BASIC.has(event.toolName) && !result.toolsUsed!.includes(event.toolName)) result.toolsUsed!.push(event.toolName);
			if (event.type === "tool_execution_start" && event.toolName === "read" && /(^|\/)SKILL\.md$/.test(String(event.args?.path ?? ""))) {
				const name = skillName(String(event.args.path));
				if (!result.skillsRead!.includes(name)) result.skillsRead!.push(name);
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
			clearTimeout(settled);
			running.delete(child);
			signal?.removeEventListener("abort", onAbort);
			// Leftovers of the group (a server started in background) go with the step.
			if (child.pid !== undefined)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {}
			if (code !== 0 && !settled && !result.error) result.error = `pi è uscito con codice ${code}: ${stderrTail.trim().slice(-300)}`;
			result.ok = !result.error;
			resolve(result);
		});
	});
}
