#!/usr/bin/env node
/**
 * Cross-platform setup of pi-claude (Linux, macOS, WSL and native Windows): Pi settings defaults, keybindings, and
 * migration from the old per-file registrations to the single Pi package. install.sh calls it; on Windows run
 *   node <pi-claude>/scripts/setup.mjs [--source <path or git:...>]
 * Idempotent. Values the user already chose are kept.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GIT_SOURCE = "git:github.com/FedericoPartesano/pi-claude";
/** Sub-packages that used to be installed one by one with `pi install <repo>/<name>`. */
const SUBPACKAGES = new Set(["pi-claude-code", "pi-picker", "pi-ui"]);
/** Extensions that used to be registered one by one in settings.json. */
const EXTENSIONS = new Set(["intent", "lean-tools", "loop", "goal", "memory", "protected-paths"]);

export function applyDefaults(settings) {
	const s = structuredClone(settings);
	s.defaultProvider ??= "claude-code";
	s.defaultModel ??= "sonnet";
	s.defaultThinkingLevel ??= "medium";
	// pi-ui: Neon Night theme and no resource listing at startup.
	s.theme ??= "neon-night";
	s.quietStartup ??= true;
	// Compact at ~60% of a 200k window instead of near the limit (long sessions answered slowly).
	s.compaction ??= {};
	s.compaction.reserveTokens ??= 80000;
	// Thinking folded to one line ("◇ penso ▸"): Ctrl+T opens it.
	s.hideThinkingBlock ??= true;
	return s;
}

export function applyKeybindings(keybindings) {
	const k = { ...keybindings };
	// On WSL and Windows Pi pastes images with Alt+V only; Ctrl+V too where the terminal passes it (WezTerm).
	k["app.clipboard.pasteImage"] ??= ["alt+v", "ctrl+v"];
	return k;
}

const sourceOf = (entry) => (typeof entry === "string" ? entry : entry?.source);
/** "git:github.com/x/y@v1", "https://github.com/x/y.git", "github.com/x/y" → "github.com/x/y". */
const repoOf = (value) => value.replace(/^git:/, "").replace(/^https?:\/\//, "").replace(/^git@github\.com:/, "github.com/").replace(/@[^/]*$/, "").replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
const sameRepo = (value) => repoOf(value) === repoOf(GIT_SOURCE);
const lastSegment = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

/** Drops this repo's old registrations (sub-packages, single extensions) and adds the package entry once. */
export function migrateSettings(settings, { source: wanted }) {
	const s = structuredClone(settings);
	// Installed from git in any form (git:…, https://….git, with a ref): that entry is the package, as written.
	const pinned = wanted === GIT_SOURCE ? (s.packages ?? []).map(sourceOf).find((value) => typeof value === "string" && sameRepo(value)) : undefined;
	const source = pinned ?? wanted;
	const isOldSubpackage = (entry) => {
		const value = sourceOf(entry);
		return typeof value === "string" && !/^(npm|git):/.test(value) && SUBPACKAGES.has(lastSegment(value));
	};
	const isOldExtension = (entry) => typeof entry === "string" && /pi-claude/.test(entry) && /[\\/]extensions[\\/]/.test(entry) && EXTENSIONS.has(lastSegment(entry).replace(/\.ts$/, ""));
	if (s.extensions) s.extensions = s.extensions.filter((entry) => !isOldExtension(entry));
	const packages = (s.packages ?? []).filter((entry) => !isOldSubpackage(entry));
	const isThis = (entry) => {
		const value = sourceOf(entry);
		return value === source || (typeof value === "string" && /^(git:|https?:|git@)/.test(value) && sameRepo(value));
	};
	s.packages = [...packages.filter((entry) => !isThis(entry) || sourceOf(entry) === source)];
	if (!s.packages.some((entry) => sourceOf(entry) === source)) s.packages.push(source);
	return s;
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
const writeJson = (file, value) => {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function main(argv) {
	const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const at = argv.indexOf("--source");
	// Installed from git (under <agent>/git/): keep the git entry; a working copy: the folder itself (edits show at once).
	const fromGit = resolve(repo).startsWith(resolve(agentDir, "git"));
	const source = at !== -1 ? argv[at + 1] : fromGit ? GIT_SOURCE : repo;
	const settingsFile = join(agentDir, "settings.json");
	writeJson(settingsFile, migrateSettings(applyDefaults(readJson(settingsFile)), { source }));
	const keysFile = join(agentDir, "keybindings.json");
	writeJson(keysFile, applyKeybindings(readJson(keysFile)));
	console.log(`pi-claude: impostazioni pronte (pacchetto: ${source})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
