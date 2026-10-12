/**
 * The team grows with the work: the manager can propose new specialists in a plan (`newRoles`), e.g. a
 * Vue developer when the project uses Vue and no member knows it. They are shown in the plan checkpoint
 * and, once the plan is approved, saved in ~/.pi/agent/team/roles/ as ordinary role files: from then on
 * they are members like the built-in ones (the user can edit or delete them).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRole, roleMarkdown, USER_ROLES_DIRECTORY, type Role } from "./roles.ts";
import type { StackMatch } from "./stack.ts";

export interface NewRoleSpec {
	name: string;
	/** Existing role it specialises (usually implementer, tester or reviewer). */
	extends: string;
	description: string;
	/** Dependencies that make it relevant (package names, `@scope/*`). */
	stack?: string[];
	/** Only the expertise: the base role's general rules are inherited. */
	instructions: string;
	model?: string;
}

export const MAX_NEW_ROLES = 3;
const MIN_EXPERTISE_CHARS = 120;

export function validateNewRoles(specs: NewRoleSpec[] | undefined, roles: Map<string, Role>): string[] {
	if (!specs?.length) return [];
	const problems: string[] = [];
	if (specs.length > MAX_NEW_ROLES) problems.push(`newRoles has ${specs.length} roles (max ${MAX_NEW_ROLES} per plan): add only the specialists this job needs`);
	const names = new Set<string>();
	for (const spec of specs) {
		const label = `new role "${spec.name}"`;
		if (!/^[a-z][a-z0-9-]{1,30}$/.test(spec.name ?? "")) problems.push(`${label}: name must be lowercase kebab-case (e.g. vue-dev)`);
		if (roles.has(spec.name)) problems.push(`${label} already exists: use it`);
		if (names.has(spec.name)) problems.push(`${label} is declared twice`);
		names.add(spec.name);
		if (!roles.has(spec.extends)) problems.push(`${label}: extends unknown role "${spec.extends}"`);
		if (!spec.description?.trim()) problems.push(`${label}: description is empty`);
		if ((spec.instructions?.trim().length ?? 0) < MIN_EXPERTISE_CHARS) {
			problems.push(`${label}: instructions too short: write the concrete expertise (conventions, pitfalls, how to test) as a short list`);
		}
		if (spec.model && !["haiku", "sonnet", "opus"].includes(spec.model)) problems.push(`${label}: model must be haiku, sonnet or opus`);
	}
	return problems;
}

/** The roles the plan may use: existing ones plus the proposed specialists (not saved yet). */
export function withNewRoles(roles: Map<string, Role>, specs: NewRoleSpec[] | undefined): Map<string, Role> {
	const all = new Map(roles);
	for (const spec of specs ?? []) all.set(spec.name, parseRole(specMarkdown(spec), spec.name, roles.get(spec.extends)));
	return all;
}

function specMarkdown(spec: NewRoleSpec): string {
	return roleMarkdown(
		{ name: spec.name, description: spec.description, extends: spec.extends, model: spec.model, stack: spec.stack?.join(", "), origin: `aggiunto dal team il ${new Date().toISOString().slice(0, 10)}` },
		spec.instructions,
	);
}

/** Saves the new members as role files; never overwrites a file the user already has. Returns the saved paths. */
export function saveNewRoles(specs: NewRoleSpec[] | undefined, directory = USER_ROLES_DIRECTORY): string[] {
	if (!specs?.length) return [];
	mkdirSync(directory, { recursive: true });
	const saved: string[] = [];
	for (const spec of specs) {
		const file = join(directory, `${spec.name}.md`);
		if (existsSync(file)) continue;
		writeFileSync(file, specMarkdown(spec));
		saved.push(file);
	}
	return saved;
}

/** Well-known stacks the team may lack a specialist for: label → dependency patterns. */
export const KNOWN_STACKS: Record<string, string[]> = {
	"Vue": ["vue", "nuxt"],
	"Angular": ["@angular/core"],
	"Svelte": ["svelte", "@sveltejs/kit"],
	"Next.js": ["next"],
	"React Native": ["react-native", "expo"],
	"Fastify": ["fastify"],
	"Koa": ["koa"],
	"Hono": ["hono"],
	"Prisma": ["prisma", "@prisma/client"],
	"TypeORM": ["typeorm"],
	"Mongoose": ["mongoose"],
	"GraphQL": ["graphql", "@apollo/server", "@apollo/client"],
	"Playwright": ["@playwright/test"],
	"Cypress": ["cypress"],
	"Three.js": ["three"],
	"Tauri": ["@tauri-apps/api"],
	"SolidJS": ["solid-js"],
};

const covered = (pattern: string, roles: Map<string, Role>) =>
	[...roles.values()].some((role) => role.stack?.some((own) => own === pattern || (own.endsWith("/*") && pattern.startsWith(own.slice(0, -1)))));

/** Known stacks present in the project that no member covers. */
export function uncoveredStacks(dependencies: Map<string, string[]>, roles: Map<string, Role>): { label: string; dependency: string; folders: string[] }[] {
	const result: { label: string; dependency: string; folders: string[] }[] = [];
	for (const [label, patterns] of Object.entries(KNOWN_STACKS)) {
		const dependency = patterns.find((pattern) => dependencies.has(pattern));
		if (dependency && !patterns.some((pattern) => covered(pattern, roles))) result.push({ label, dependency, folders: dependencies.get(dependency)! });
	}
	return result;
}

/** The manager's guidance on members for this project: specialists to use, and gaps it may fill with newRoles. */
export function teamGuidance(found: StackMatch[], gaps: ReturnType<typeof uncoveredStacks>, formatSpecialists: (found: StackMatch[]) => string): string {
	const parts = [formatSpecialists(found)];
	if (gaps.length) {
		parts.push([
			`Nel progetto ci sono stack senza uno specialista nel team: ${gaps.map((gap) => `${gap.label} (${gap.dependency})`).join(", ")}.`,
			"Se il lavoro li tocca in modo sostanziale, aggiungi lo specialista nel piano con `newRoles`",
			"(extends implementer o tester, stack con le dipendenze, istruzioni = solo le competenze specifiche): resterà nel team per i lavori futuri.",
		].join(" "));
	}
	return parts.filter(Boolean).join("\n\n");
}
