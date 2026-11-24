#!/usr/bin/env node
/**
 * `pi doctor`: checks what pi-claude needs and installs what is missing.
 *   pi doctor           check, fix, check again; if something is still broken, Claude (haiku) reads the report and says why
 *   pi doctor --check   only check (exit 1 when something is broken)
 *   pi doctor --no-ai   fix without asking Claude
 *
 * Checks: Node ≥ 22.19, npm, Pi, claude, settings.json and ~/.pi/acp.json as scripts/setup.mjs writes them, every package
 * in settings.json really downloaded (Pi skips missing ones in silence under PI_OFFLINE=1, which bin/pi.mjs sets), and the
 * dependencies of the repo folders. Fixes: setup.mjs, `pi install <source>`, `npm install`, `npm install -g`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_NODE = [22, 19];
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** "npm:@scope/name@1.2.3" → { name: "@scope/name", version: "1.2.3" }; undefined for other sources. */
const parseNpm = (source) => {
	const m = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.+))?$/.exec(source);
	return m ? { name: m[1], version: m[2] } : undefined;
};

/**
 * State of one settings.json package: "ok", "missing" or the installed version when an exact pin differs.
 * readVersion(name) is the version under <agent>/npm/node_modules, exists(path) checks git checkouts and local folders.
 */
export function packageState(source, readVersion, exists) {
	const npm = parseNpm(source);
	if (npm) {
		const installed = readVersion(npm.name);
		if (!installed) return "missing";
		return npm.version && /^\d+\.\d+\.\d+/.test(npm.version) && installed !== npm.version ? installed : "ok";
	}
	return exists(source) ? "ok" : "missing";
}

/** Every dependency found in <repo>/<dir>/node_modules or, as Node resolves upwards, in <repo>/node_modules. */
export function depsInstalled(repo, dir, deps, exists) {
	const roots = [...new Set([join(repo, dir, "node_modules"), join(repo, "node_modules")])];
	return deps.every((name) => roots.some((root) => exists(join(root, name))));
}

/** Deep equality that ignores object key order (arrays keep theirs). */
export function sameJson(a, b) {
	if (a === b) return true;
	if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a), kb = Object.keys(b);
	return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

const older = (version, [major, minor]) => {
	const [a, b] = String(version).replace(/^v/, "").split(".").map(Number);
	return a < major || (a === major && b < minor);
};

/** Checks from the gathered facts: { id, ok, level: "err" | "note", text, fix?: { cmd, cwd?, env? } }. Pure, for the tests. */
export function diagnose(f) {
	const out = [];
	const add = (id, ok, text, fix) => out.push({ id, ok, level: ok ? "note" : "err", text, fix: ok ? undefined : fix });
	add("node", !older(f.node, MIN_NODE), older(f.node, MIN_NODE) ? `Node ${f.node}: serve ≥ ${MIN_NODE.join(".")} (aggiornalo, per esempio con nvm)` : `Node ${f.node}`);
	add("npm", f.npm, f.npm ? "npm" : "npm non trovato: si installa insieme a Node");
	const piFix = { cmd: ["npm", "install", "-g", `${PI_PACKAGE}@${f.wantedPi}`] };
	if (!f.pi) add("pi", false, "Pi non installato", piFix);
	else add("pi", true, f.pi === f.wantedPi ? `Pi ${f.pi}` : `Pi ${f.pi} (la repo è testata con ${f.wantedPi})`);
	add("claude", Boolean(f.claude), f.claude ? `claude ${f.claude}` : "claude non trovato: serve il binario ufficiale (poi `claude` per il login)", { cmd: ["npm", "install", "-g", "@anthropic-ai/claude-code"] });
	// One fix object for both: main runs it once.
	const setup = { cmd: [process.execPath, join(f.repo, "scripts", "setup.mjs")] };
	add("settings", !f.settingsDrift, f.settingsDrift ? "settings.json non è come lo scrive setup.mjs (pacchetti o impostazioni mancanti)" : "settings.json", setup);
	add("acp", !f.acpDrift, f.acpDrift ? "~/.pi/acp.json (profilo di billion-context) mancante o incompleto" : "~/.pi/acp.json", setup);
	for (const p of f.packages) {
		const ok = p.state === "ok";
		const text = ok ? p.source : p.state === "missing" ? `${p.source}: configurato ma non scaricato` : `${p.source}: installata la ${p.state}`;
		// PI_OFFLINE set to undefined: spawn drops it, so pi install may reach npm even when started from bin/pi.mjs.
		add(`pkg:${p.source}`, ok, text, { cmd: ["pi", "install", p.source], env: { PI_OFFLINE: undefined } });
	}
	for (const d of f.folders) {
		const where = d.dir === "." ? "repo" : d.dir;
		add(`deps:${d.dir}`, d.modules, d.modules ? `dipendenze ${where}` : `dipendenze di ${where} non installate`, {
			cmd: ["npm", "install", "--no-audit", "--no-fund", "--loglevel=error"],
			cwd: d.dir === "." ? f.repo : join(f.repo, d.dir),
			// onnxruntime-node would fetch CUDA binaries on Linux x64 (not needed, and the 1.21.0 archive is a 404).
			env: { ONNXRUNTIME_NODE_INSTALL_CUDA: "skip" },
		});
	}
	return out;
}

/** Prompt for `claude -p` when fixes did not solve everything: only the broken checks and the failed command output. */
export function aiPrompt(checks, failures, platform) {
	const broken = checks.filter((c) => !c.ok).map((c) => `- ${c.text}`).join("\n");
	const failed = failures.map((f) => `$ ${f.cmd}\n${f.output.slice(-600)}`).join("\n\n");
	return [
		`pi-claude doctor on ${platform} could not fix these problems (Pi coding agent + pi-claude package + billion-context-pi):`,
		broken,
		failed && `Failed commands:\n${failed}`,
		"Answer in Italian, at most 6 short lines: the likely cause and the exact commands the user should run, then `pi doctor` again. Do not run anything yourself.",
	].filter(Boolean).join("\n\n");
}

/** `claude` arguments for the diagnosis: haiku, no tools, no MCP servers, no saved session. Run from a temp dir (no project context). */
export const aiArgs = (prompt) => ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--no-session-persistence", prompt];

/** Printable form of a fix command (node for the running binary). */
const labelOf = (fix) => fix.cmd.map((a) => (a === process.execPath ? "node" : a)).join(" ");

/** Fixes still to run, each once (setup.mjs fixes two checks); failed holds the labels of commands that already failed. */
export function nextFixes(checks, failed) {
	const fixes = [];
	for (const c of checks) if (!c.ok && c.fix && !fixes.includes(c.fix) && !failed.has(labelOf(c.fix))) fixes.push(c.fix);
	return fixes;
}

// ---- gathering (real system) ----

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", timeout: 30_000, ...opts });
const versionOf = (cmd) => {
	const r = run(cmd, ["--version"], { env: { ...process.env, PI_OFFLINE: "1" } });
	return r.status === 0 ? (/\d+\.\d+\.\d+/.exec(r.stdout + r.stderr)?.[0] ?? "?") : undefined;
};
const readJson = (file) => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
};

export async function gather(repo, agentDir) {
	const setup = await import(join(repo, "scripts", "setup.mjs"));
	const settings = readJson(join(agentDir, "settings.json")) ?? {};
	const fromGit = resolve(repo).startsWith(resolve(agentDir, "git"));
	const wanted = setup.applyContextCompression(setup.migrateSettings(setup.applyDefaults(settings), { source: fromGit ? setup.GIT_SOURCE : repo }));
	const acp = readJson(join(homedir(), ".pi", "acp.json"));
	const profile = readJson(join(repo, "scripts", "acp-profile.json")) ?? {};
	const wantedPi = /^PI_VERSION="([^"]+)"/m.exec(readFileSync(join(repo, "install.sh"), "utf8"))?.[1] ?? "?";
	const readVersion = (name) => readJson(join(agentDir, "npm", "node_modules", name, "package.json"))?.version;
	const exists = (source) => {
		if (/^(git:|https?:|git@)/.test(source)) {
			const path = source.replace(/^git:/, "").replace(/^https?:\/\//, "").replace(/^git@([^:]+):/, "$1/").replace(/@[^/]*$/, "").replace(/\.git$/, "");
			return existsSync(join(agentDir, "git", path));
		}
		return existsSync(resolve(agentDir, source.replace(/^~(?=\/|$)/, homedir())));
	};
	const sources = (settings.packages ?? []).map((p) => (typeof p === "string" ? p : p?.source)).filter((s) => typeof s === "string");
	// Runtime dependencies only: devDependencies (typescript, test tools) are not needed to run Pi.
	const folders = [".", ...readdirSync(repo).filter((n) => n.startsWith("pi-") && existsSync(join(repo, n, "package.json")))]
		.map((dir) => ({ dir, deps: Object.keys(readJson(join(repo, dir, "package.json"))?.dependencies ?? {}) }))
		.filter((d) => d.deps.length > 0)
		.map((d) => ({ dir: d.dir, modules: depsInstalled(repo, d.dir, d.deps, existsSync) }));
	return {
		node: process.version,
		npm: Boolean(versionOf("npm")),
		claude: versionOf("claude"),
		pi: versionOf("pi"),
		wantedPi,
		settingsDrift: !sameJson(wanted, settings),
		acpDrift: !acp || !sameJson(setup.applyAcpDefaults(acp, profile), acp),
		packages: sources.map((source) => ({ source, state: packageState(source, readVersion, exists) })),
		folders,
		repo,
	};
}

const print = (checks, all) => {
	for (const c of checks) if (all || !c.ok) console.log(`${c.ok ? "✓" : "✗"} ${c.text}`);
};

async function main(argv) {
	const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	let checks = diagnose(await gather(repo, agentDir));
	print(checks, true);
	if (argv.includes("--check")) process.exit(checks.some((c) => !c.ok) ? 1 : 0);
	const failures = [];
	const failed = new Set();
	// Two rounds: setup.mjs can add packages (billion-context) that the second round then downloads.
	for (let round = 0; round < 2; round++) {
		const fixes = nextFixes(checks, failed);
		if (!fixes.length) break;
		for (const fix of fixes) {
			const [cmd, ...args] = fix.cmd;
			const label = labelOf(fix);
			process.stdout.write(`→ ${label}${fix.cwd ? ` (in ${fix.cwd})` : ""}… `);
			const env = { ...process.env, ...fix.env };
			for (const [k, v] of Object.entries(fix.env ?? {})) if (v === undefined) delete env[k];
			const r = run(cmd, args, { cwd: fix.cwd, env, timeout: 600_000 });
			console.log(r.status === 0 ? "fatto" : "non riuscito");
			if (r.status !== 0) {
				failed.add(label);
				failures.push({ cmd: label, output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}` });
			}
		}
		checks = diagnose(await gather(repo, agentDir));
	}
	const broken = checks.filter((c) => !c.ok);
	if (!broken.length) {
		console.log("RISULTATO: tutto a posto. Se Pi è aperto, riavvialo o usa /reload.");
		return;
	}
	console.log("RISULTATO: restano da sistemare:");
	print(broken, false);
	const claude = checks.find((c) => c.id === "claude")?.ok;
	if (argv.includes("--no-ai") || !claude) process.exit(1);
	console.log("\nChiedo a Claude (haiku) una diagnosi…");
	const r = run("claude", aiArgs(aiPrompt(checks, failures, `${process.platform} ${process.arch}`)), { cwd: tmpdir(), timeout: 120_000 });
	console.log(r.status === 0 ? r.stdout.trim() : "Claude non ha risposto.");
	process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
