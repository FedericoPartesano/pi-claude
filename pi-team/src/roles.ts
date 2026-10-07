/**
 * Team roles: markdown files with a small frontmatter (name, description, model, thinking, tools,
 * writes) and the role instructions as body. Built-in roles live in the package `roles/` folder;
 * files in ~/.pi/agent/team/roles/ override or add roles by name.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Role {
	name: string;
	description: string;
	/** claude-code model id: haiku | sonnet | opus */
	model: string;
	thinking: string;
	/** Pi tool allowlist for the agent. */
	tools: string[];
	/** True when the role changes files: such tasks never run in parallel with each other. */
	writes: boolean;
	/** Cumulative input tokens (cache included) after which the agent is stopped; undefined = no cap. */
	maxInputTokens?: number;
	instructions: string;
}

export const BUILT_IN_ROLES_DIRECTORY = new URL("../roles/", import.meta.url).pathname;
export const USER_ROLES_DIRECTORY = join(homedir(), ".pi/agent/team/roles");

export function parseRole(text: string, fallbackName: string): Role {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	const fields = new Map<string, string>();
	for (const line of (match?.[1] ?? "").split("\n")) {
		const separator = line.indexOf(":");
		if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}
	return {
		name: fields.get("name") || fallbackName,
		description: fields.get("description") ?? "",
		model: fields.get("model") || "sonnet",
		thinking: fields.get("thinking") || "medium",
		tools: (fields.get("tools") || "read,bash,edit,write").split(",").map((tool) => tool.trim()).filter(Boolean),
		writes: fields.get("writes") === "true",
		maxInputTokens: Number(fields.get("maxInputTokens")) || undefined,
		instructions: (match?.[2] ?? text).trim(),
	};
}

export function loadRoles(directories = [BUILT_IN_ROLES_DIRECTORY, USER_ROLES_DIRECTORY]): Map<string, Role> {
	const roles = new Map<string, Role>();
	for (const directory of directories) {
		if (!existsSync(directory)) continue;
		for (const file of readdirSync(directory).filter((name) => name.endsWith(".md")).sort()) {
			const role = parseRole(readFileSync(join(directory, file), "utf8"), file.replace(/\.md$/, ""));
			roles.set(role.name, role);
		}
	}
	return roles;
}
