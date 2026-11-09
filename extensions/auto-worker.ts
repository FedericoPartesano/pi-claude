/**
 * Loaded only inside an auto mode child (`pi -p --no-extensions -e auto-worker.ts`), configured by PI_AUTO_*
 * env vars set by the supervisor. Three jobs, all in code: the phase skill in the system prompt (first skill of
 * the phase in full, the others by path, to keep the prefix small), the denylist on bash, and the sandbox
 * rewrite of every bash command. write/edit cannot leave the worktree nor touch frozen files.
 * Outside auto mode (no PI_AUTO_PHASE) it does nothing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

/** The text added to the system prompt for a phase: first skill in full, the rest as paths to read on need. */
export function phaseSkillText(skillsDir: string, phase: Phase): string {
	let skills: string[] = [];
	try {
		const phases = JSON.parse(readFileSync(join(skillsDir, "phases.json"), "utf8"));
		skills = Array.isArray(phases[phase]) ? phases[phase] : [];
	} catch {
		return "";
	}
	if (phase === "verify") skills = [];
	const parts: string[] = [];
	const [first, ...rest] = skills;
	if (first) {
		try {
			parts.push(`# Skill della fase ${phase}\n\n${readFileSync(join(skillsDir, first, "SKILL.md"), "utf8").replace(/^---[\s\S]*?\n---\n/, "").trim()}`);
		} catch {}
	}
	if (rest.length) parts.push(`Altre skill della fase, da leggere con read solo se servono: ${rest.map((path) => join(skillsDir, path, "SKILL.md")).join(", ")}`);
	return parts.join("\n\n");
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
	const skill = process.env.PI_AUTO_SKILLS ? phaseSkillText(process.env.PI_AUTO_SKILLS, phase) : "";
	// During define/plan the frozen set is still being written: only build onward protects it.
	const protectedPaths = phase === "define" || phase === "plan" ? [] : frozen;

	if (skill)
		pi.on("before_agent_start", (event) => {
			if (event.systemPrompt.includes("# Skill della fase ")) return;
			return { systemPrompt: `${event.systemPrompt}\n\n${skill}` };
		});

	pi.on("tool_call", (event) => {
		const input = event.input as Record<string, any>;
		if (event.toolName === "bash" && typeof input.command === "string") {
			const reason = denyReason(input.command, phase, worktree);
			if (reason) return { block: true, reason: `Bloccato da auto mode: ${reason}` };
			input.command = sandboxCommand(input.command, { worktree, gitDir, network, readOnly, bwrap, unshare });
			return;
		}
		if ((event.toolName === "write" || event.toolName === "edit") && typeof input.path === "string") {
			const reason = writeDenyReason(input.path, worktree, protectedPaths);
			if (reason) return { block: true, reason: `Bloccato da auto mode: ${reason}` };
		}
	});
}
