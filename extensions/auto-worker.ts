/**
 * Loaded only inside an auto mode child (`pi -p --no-extensions -e auto-worker.ts`), configured by PI_AUTO_*
 * env vars set by the supervisor. Three jobs, all in code: the step's skills in the system prompt (chosen by the
 * supervisor, auto/skills.ts: a few in full, the others by path), the denylist on bash, and the sandbox
 * rewrite of every bash command. write/edit cannot leave the worktree nor touch frozen files.
 * Outside auto mode (no PI_AUTO_PHASE) it does nothing.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type SkillSet, skillText } from "./auto/skills.ts";
import { type ToolGroup, toolsNote } from "./auto/tools.ts";
import { denyReason, networkAllowed, PHASES, sandboxCommand, writeDenyReason, type Phase } from "./auto/policy.ts";

const has = (binary: string, args: string[]) => {
	try {
		execFileSync(binary, args, { stdio: "ignore", timeout: 5000 });
		return true;
	} catch {
		return false;
	}
};

const list = (text: string | undefined): string[] => {
	try {
		const value = JSON.parse(text ?? "[]");
		return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
	} catch {
		return [];
	}
};

/** System prompt text of the step's skills, chosen by the supervisor (auto/skills.ts) and passed in PI_AUTO_SKILL_SET. */
export function stepSkillText(skillsDir: string | undefined, setJson: string | undefined): string {
	if (!skillsDir || !setJson) return "";
	try {
		const set = JSON.parse(setJson) as SkillSet;
		return Array.isArray(set.inline) && Array.isArray(set.list) ? skillText(skillsDir, set) : "";
	} catch {
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	const phase = process.env.PI_AUTO_PHASE as Phase | undefined;
	const worktree = process.env.PI_AUTO_WORKTREE;
	if (!phase || !PHASES.includes(phase) || !worktree) return;
	const frozen = list(process.env.PI_AUTO_FROZEN);
	const readOnly = list(process.env.PI_AUTO_READONLY);
	const gitDir = process.env.PI_AUTO_GIT_DIR ?? join(worktree, ".git");
	const network = networkAllowed(phase);
	const bwrap = process.platform === "linux" && process.env.PI_AUTO_BWRAP !== "0" && has("bwrap", ["--ro-bind", "/", "/", "true"]);
	const unshare = process.platform === "linux" && has("unshare", ["-rn", "true"]);
	// Browser steps keep the host network for bash/lancia: Chrome must reach the app on localhost (auto/tools.ts).
	const sandboxNetwork = network || process.env.PI_AUTO_LOCALNET === "1";
	const skill = [stepSkillText(process.env.PI_AUTO_SKILLS, process.env.PI_AUTO_SKILL_SET), toolsNote(list(process.env.PI_AUTO_TOOLS) as ToolGroup[])].filter(Boolean).join("\n\n");
	// During define/plan the frozen set is still being written: only build onward protects it.
	const protectedPaths = phase === "define" || phase === "plan" ? [] : frozen;

	if (skill)
		pi.on("before_agent_start", (event) => {
			if (event.systemPrompt.includes(skill)) return;
			return { systemPrompt: `${event.systemPrompt}\n\n${skill}` };
		});

	const BASH_TIMEOUT_S = Number(process.env.PI_AUTO_BASH_SECONDS) || 300;
	pi.on("tool_call", (event) => {
		const input = event.input as Record<string, any>;
		// lancia runs a shell command too (in background): same denylist and sandbox as bash.
		if ((event.toolName === "bash" || event.toolName === "lancia") && typeof input.command === "string") {
			const reason = denyReason(input.command, phase, worktree);
			if (reason) return { block: true, reason: `Bloccato da auto mode: ${reason}` };
			// A model's runaway command (e.g. `find /` over WSL's /mnt/c) must not eat the whole step.
			if (event.toolName === "bash" && !(typeof input.timeout === "number" && input.timeout > 0 && input.timeout <= BASH_TIMEOUT_S)) input.timeout = BASH_TIMEOUT_S;
			input.command = sandboxCommand(input.command, { worktree, gitDir, network: sandboxNetwork, readOnly, bwrap, unshare });
			return;
		}
		if ((event.toolName === "write" || event.toolName === "edit") && typeof input.path === "string") {
			const reason = writeDenyReason(input.path, worktree, protectedPaths);
			if (reason) return { block: true, reason: `Bloccato da auto mode: ${reason}` };
		}
	});
}
