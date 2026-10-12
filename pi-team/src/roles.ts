/**
 * Team roles: markdown files with a small frontmatter (name, description, model, thinking, tools,
 * writes, maxInputTokens, extends, stack) and the role instructions as body. Built-in roles live in the
 * package `roles/` folder; files in ~/.pi/agent/team/roles/ override or add roles by name.
 *
 * Specialists: `extends: implementer` inherits every field the file does not set and puts the base
 * instructions before its own (general rules first, then the expertise). `stack:` lists the dependencies
 * that make the specialist relevant (`react`, `@nestjs/*`): see stack.ts.
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
	/** Base role this one specialises. */
	extends?: string;
	/** Dependencies (package names, `@scope/*` allowed) that make this specialist relevant to a project. */
	stack?: string[];
	/** Free note on where the role comes from ("aggiunto dal team il 2026-10-10"). */
	origin?: string;
	/** Official documentation the expertise was checked against (URLs). Not sent to the agent. */
	sources?: string[];
	/** When and against which versions the expertise was checked ("2026-10-10: express 5.3"). */
	verified?: string;
}

export const BUILT_IN_ROLES_DIRECTORY = new URL("../roles/", import.meta.url).pathname;
export const USER_ROLES_DIRECTORY = join(homedir(), ".pi/agent/team/roles");

interface RoleSource {
	fields: Map<string, string>;
	body: string;
	fallbackName: string;
}

function readSource(text: string, fallbackName: string): RoleSource {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	const fields = new Map<string, string>();
	for (const line of (match?.[1] ?? "").split("\n")) {
		const separator = line.indexOf(":");
		if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}
	return { fields, body: (match?.[2] ?? text).trim(), fallbackName };
}

const list = (value: string | undefined) => value?.split(",").map((item) => item.trim()).filter(Boolean);

/** A role from its source; fields the file leaves out come from `base` (when it extends one), else defaults. */
function buildRole({ fields, body, fallbackName }: RoleSource, base?: Role): Role {
	const get = (key: string) => fields.get(key) || undefined;
	return {
		name: get("name") ?? fallbackName,
		description: fields.get("description") ?? base?.description ?? "",
		model: get("model") ?? base?.model ?? "sonnet",
		thinking: get("thinking") ?? base?.thinking ?? "medium",
		tools: list(get("tools")) ?? base?.tools ?? ["read", "bash", "edit", "write"],
		writes: fields.has("writes") ? fields.get("writes") === "true" : base?.writes ?? false,
		maxInputTokens: Number(get("maxInputTokens")) || base?.maxInputTokens,
		instructions: base ? `${base.instructions}\n\n${body}` : body,
		extends: get("extends"),
		stack: list(get("stack")),
		origin: get("origin"),
		sources: list(get("sources")),
		verified: get("verified"),
	};
}

/** Role file text from its fields and body (the inverse of parsing: new members are saved like this). */
export function roleMarkdown(fields: Record<string, string | undefined>, body: string): string {
	const header = Object.entries(fields).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${key}: ${String(value).replace(/\n/g, " ")}`);
	return `---\n${header.join("\n")}\n---\n${body.trim()}\n`;
}

export function parseRole(text: string, fallbackName: string, base?: Role): Role {
	return buildRole(readSource(text, fallbackName), base);
}

export function loadRoles(directories = [BUILT_IN_ROLES_DIRECTORY, USER_ROLES_DIRECTORY]): Map<string, Role> {
	// Later directories override earlier ones by name; inheritance is resolved after all files are read.
	const sources = new Map<string, RoleSource>();
	for (const directory of directories) {
		if (!existsSync(directory)) continue;
		for (const file of readdirSync(directory).filter((name) => name.endsWith(".md")).sort()) {
			const source = readSource(readFileSync(join(directory, file), "utf8"), file.replace(/\.md$/, ""));
			sources.set(source.fields.get("name") || source.fallbackName, source);
		}
	}
	const roles = new Map<string, Role>();
	const resolve = (name: string, seen: string[]): Role | undefined => {
		if (roles.has(name)) return roles.get(name);
		const source = sources.get(name);
		if (!source || seen.includes(name)) return undefined; // unknown base or cycle: no inheritance
		const baseName = source.fields.get("extends");
		const base = baseName ? resolve(baseName, [...seen, name]) : undefined;
		const role = buildRole(source, base);
		roles.set(name, role);
		return role;
	};
	for (const name of [...sources.keys()].sort()) resolve(name, []);
	return roles;
}
