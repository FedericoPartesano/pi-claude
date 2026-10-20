/** Finds the sources: CLAUDE.md files and the Obsidian vault (.md only, hidden folders and .vaultignore excluded). */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { VaultFile } from "./index.ts";

export const MAX_FILE_BYTES = 300_000;
export const MAX_FILES = 20_000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".obsidian", ".trash"]);

/** Vault folder: PI_VAULT, else the first folder from cwd upward with .obsidian/, else a subfolder of cwd (up to 2 levels, e.g. repo/vault/) with it. */
export function findVault(cwd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	if (env.PI_VAULT) return existsSync(env.PI_VAULT) ? env.PI_VAULT : undefined;
	for (let dir = cwd; ; ) {
		if (existsSync(join(dir, ".obsidian"))) return dir;
		const parent = join(dir, "..");
		if (parent === dir || dir === "/") break;
		dir = parent;
	}
	const down = (dir: string, depth: number): string | undefined => {
		let names: string[] = [];
		try {
			names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)).map((entry) => entry.name).sort();
		} catch {}
		for (const name of names) if (existsSync(join(dir, name, ".obsidian"))) return join(dir, name);
		if (depth > 1) for (const name of names) { const found = down(join(dir, name), depth - 1); if (found) return found; }
		return undefined;
	};
	return down(cwd, 2);
}

/** Gitignore-like lines of .vaultignore: `name`, `dir/`, `*.md` wildcards; matched on the relative path and on each segment. */
export function ignoreMatcher(content: string): (path: string) => boolean {
	const rules = content.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
		const pattern = line.replace(/\/$/, "").replace(/^\//, "");
		return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
	});
	return (path) => {
		const parts = path.split("/");
		return rules.some((rule) => rule.test(path) || parts.some((part, index) => rule.test(part) || rule.test(parts.slice(0, index + 1).join("/"))));
	};
}

export function claudeMdFiles(cwd: string, home = homedir()): { id: string; file: string }[] {
	return [
		{ id: "CLAUDE.md", file: join(cwd, "CLAUDE.md") },
		{ id: "~/.claude/CLAUDE.md", file: join(home, ".claude", "CLAUDE.md") },
	].filter((item) => existsSync(item.file));
}

export function vaultFiles(root: string): { path: string; file: string }[] {
	let ignored: (path: string) => boolean = () => false;
	try {
		ignored = ignoreMatcher(readFileSync(join(root, ".vaultignore"), "utf8"));
	} catch {}
	const out: { path: string; file: string }[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (out.length >= MAX_FILES) return;
			const full = join(dir, entry.name);
			const rel = relative(root, full).split(sep).join("/");
			if (entry.name.startsWith(".") || ignored(rel)) continue;
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(full);
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push({ path: rel, file: full });
		}
	};
	walk(root);
	return out;
}

/** Reads every source (the vault's files and the CLAUDE.md ones); too large or unreadable files are skipped. */
export function readSources(cwd: string, vault: string | undefined, home = homedir()): VaultFile[] {
	const all = [...claudeMdFiles(cwd, home).map((item) => ({ path: item.id, file: item.file })), ...(vault ? vaultFiles(vault) : [])];
	const seen = new Set<string>();
	return all.flatMap((item) => {
		if (seen.has(item.file)) return [];
		seen.add(item.file);
		try {
			return statSync(item.file).size > MAX_FILE_BYTES ? [] : [{ path: item.path, source: readFileSync(item.file, "utf8") }];
		} catch {
			return [];
		}
	});
}
