/**
 * Which specialists fit a project: the dependencies of its package.json files (the root, workspaces
 * and first-level folders such as `frontend/`, `apps/web/`), matched against each role's `stack`.
 * Deterministic and cheap: no model, only a few small files read.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Role } from "./roles.ts";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", "vendor"]);
const CONTAINERS = ["apps", "packages", "services", "libs"];

/** package.json files of the project: root, its first-level folders and apps/*, packages/*, … (max depth 2). */
export function packageFiles(cwd: string): string[] {
	const files: string[] = [];
	const add = (directory: string) => {
		const file = join(directory, "package.json");
		if (existsSync(file)) files.push(file);
	};
	const folders = (directory: string) => {
		try {
			return readdirSync(directory).filter((name) => !name.startsWith(".") && !SKIP.has(name) && statSync(join(directory, name)).isDirectory()).sort();
		} catch {
			return [];
		}
	};
	add(cwd);
	for (const name of folders(cwd)) {
		add(join(cwd, name));
		if (CONTAINERS.includes(name)) for (const inner of folders(join(cwd, name))) add(join(cwd, name, inner));
	}
	return files.slice(0, 40);
}

/** Each package.json of the project: its folder (relative, "." for the root) and dependency → version range. */
function manifests(cwd: string): { folder: string; dependencies: Record<string, string> }[] {
	const result: { folder: string; dependencies: Record<string, string> }[] = [];
	for (const file of packageFiles(cwd)) {
		let manifest: Record<string, unknown>;
		try {
			manifest = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		const dependencies: Record<string, string> = {};
		// peer first: the installed range (dependencies/devDependencies) wins.
		for (const key of ["peerDependencies", "devDependencies", "dependencies"]) Object.assign(dependencies, (manifest[key] as Record<string, string>) ?? {});
		result.push({ folder: relative(cwd, join(file, "..")) || ".", dependencies });
	}
	return result;
}

/** Dependency name → folders (relative, "." for the root) where it appears. */
export function detectDependencies(cwd: string): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const { folder, dependencies } of manifests(cwd)) {
		for (const name of Object.keys(dependencies)) {
			const folders = found.get(name) ?? [];
			if (!folders.includes(folder)) folders.push(folder);
			found.set(name, folders);
		}
	}
	return found;
}

/** Dependency name → the distinct version ranges declared for it (rules differ across majors). */
export function detectVersions(cwd: string): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const { dependencies } of manifests(cwd)) {
		for (const [name, range] of Object.entries(dependencies)) {
			if (typeof range !== "string") continue;
			const ranges = found.get(name) ?? [];
			if (!ranges.includes(range)) ranges.push(range);
			found.set(name, ranges);
		}
	}
	return found;
}

const matches = (pattern: string, dependency: string) => (pattern.endsWith("/*") ? dependency.startsWith(pattern.slice(0, -1)) : pattern === dependency);

export interface StackMatch {
	role: Role;
	/** The dependencies that matched and where. */
	evidence: { dependency: string; folders: string[]; versions?: string[] }[];
}

/** Specialists whose `stack` appears in the project, with the evidence. */
export function matchSpecialists(roles: Map<string, Role>, dependencies: Map<string, string[]>, versions = new Map<string, string[]>()): StackMatch[] {
	const result: StackMatch[] = [];
	for (const role of roles.values()) {
		if (!role.stack?.length) continue;
		const evidence = [...dependencies].filter(([dependency]) => role.stack!.some((pattern) => matches(pattern, dependency))).map(([dependency, folders]) => ({ dependency, folders, versions: versions.get(dependency) }));
		if (evidence.length) result.push({ role, evidence });
	}
	return result;
}

/** The manager's hint: which specialists to use, where. Empty when none fits. */
export function formatSpecialists(found: StackMatch[]): string {
	if (found.length === 0) return "";
	const lines = found.map(({ role, evidence }) => {
		const folders = [...new Set(evidence.flatMap((item) => item.folders))].map((folder) => (folder === "." ? "radice" : `${folder}/`));
		const named = evidence.slice(0, 3).map((item) => (item.versions?.length ? `${item.dependency}@${item.versions.join("|")}` : item.dependency));
		return `- ${role.name}: ${named.join(", ")} in ${folders.slice(0, 4).join(", ")}`;
	});
	return [
		"Specialisti adatti a questo progetto (dalle dipendenze dei package.json):",
		...lines,
		"Per i compiti nel loro ambito usa lo specialista invece dell'implementer generico; per il resto i ruoli generici.",
		"Scrivi nelle istruzioni del compito la versione rilevata: le regole degli specialisti cambiano tra le major.",
	].join("\n");
}
