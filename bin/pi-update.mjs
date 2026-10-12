#!/usr/bin/env node
/**
 * Updates pi-claude (this repository) and Pi itself, adapting to what it finds:
 *   pi-update --check   prints JSON with what is new (nothing is changed); used by extensions/updates.ts at startup
 *   pi-update           applies it
 *
 * pi-claude: `git pull --ff-only` on the current branch (your uncommitted work is kept aside and put back; unpushed commits
 * or a diverged branch are never touched), then `npm install` only in the folders whose package.json or lock changed.
 * Pi: `npm install -g` the latest version, then Pi is started once to check that pi-claude still loads; if not, the
 * previous version is put back. Every step prints one plain Italian line; the last one starts with "RISULTATO:".
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** 1 if a is newer than b, -1 if older, 0 if equal ("1.10.0" > "1.9.2"; a pre-release tag counts as the plain version). */
export function compareVersions(a, b) {
	const parts = (v) => String(v).trim().replace(/^v/, "").split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
	const [x, y] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d > 0 ? 1 : -1;
	}
	return 0;
}

/** "3\t1" from `git rev-list --left-right --count HEAD...@{u}` → { ahead: 3, behind: 1 }. */
export function parseCounts(text) {
	const [ahead, behind] = text.trim().split(/\s+/).map((n) => Number.parseInt(n, 10) || 0);
	return { ahead: ahead ?? 0, behind: behind ?? 0 };
}

/** Folders (relative, "." for the root) whose dependencies must be reinstalled after a pull, given the changed files. */
export function foldersToInstall(changed, folders) {
	return folders.filter((dir) => changed.some((file) => file === (dir === "." ? "" : `${dir}/`) + "package.json" || file === (dir === "." ? "" : `${dir}/`) + "package-lock.json"));
}

const root = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..");
const NO_PROMPT = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=6" };
const run = (cmd, args, options = {}) => {
	const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: NO_PROMPT, timeout: 30_000, ...options });
	return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
};
const git = (...args) => run("git", args);
const firstLine = (text) => text.split("\n").find((line) => line.trim()) ?? "";

export function checkClaude() {
	if (!existsSync(join(root, ".git"))) return undefined;
	const upstream = git("rev-parse", "--abbrev-ref", "@{u}");
	if (!upstream.ok) return undefined;
	if (!git("fetch", "--quiet").ok) return undefined; // offline or no access: say nothing, try again next time
	const counts = git("rev-list", "--left-right", "--count", "HEAD...@{u}");
	if (!counts.ok) return undefined;
	const { ahead, behind } = parseCounts(counts.out);
	return {
		branch: git("rev-parse", "--abbrev-ref", "HEAD").out,
		behind,
		ahead,
		dirty: git("status", "--porcelain", "-uno").out !== "",
		subjects: behind ? git("log", "--format=%s", "-n", "5", "HEAD..@{u}").out.split("\n") : [],
	};
}

export function checkPi() {
	const current = process.env.PI_CURRENT_VERSION || run("pi", ["--version"]).out.split("\n").pop();
	const latest = run("npm", ["view", PI_PACKAGE, "version"], { timeout: 20_000 }).out;
	if (!current || !/^\d/.test(latest)) return undefined;
	return { current, latest, newer: compareVersions(latest, current) > 0 };
}

/** Starts Pi once, offline, and checks that pi-claude's commands are there. */
function piLoads() {
	return new Promise((resolve) => {
		const child = spawn("pi", ["--mode", "rpc"], { cwd: root, env: { ...process.env, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "ignore"] });
		let buffer = "";
		const finish = (ok) => {
			clearTimeout(timer);
			child.kill();
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), 60_000);
		child.on("error", () => finish(false));
		child.on("exit", () => finish(false));
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			for (const line of buffer.split("\n")) {
				if (!line.includes('"get_commands"')) continue;
				try {
					const names = (JSON.parse(line).data?.commands ?? []).map((command) => command.name);
					finish(names.includes("voice") || names.includes("pick"));
				} catch {
					// partial line: wait for the rest
				}
			}
		});
		child.stdin.write(`${JSON.stringify({ type: "get_commands", id: "1" })}\n`);
	});
}

const say = (text) => console.log(text);

async function update() {
	const done = [];
	let failed = false;

	const claude = checkClaude();
	if (claude?.behind) {
		if (claude.ahead) say("pi-claude: hai modifiche non ancora pubblicate, non lo tocco.");
		else {
			say(`pi-claude: scarico ${claude.behind} novità…`);
			const before = git("rev-parse", "HEAD").out;
			const pull = git("pull", "--ff-only", "--autostash", "--quiet");
			if (!pull.ok) {
				say(`pi-claude: non riesco ad aggiornarlo (${firstLine(pull.err) || "errore"}). Non ho cambiato niente.`);
				failed = true;
			} else {
				const changed = git("diff", "--name-only", `${before}..HEAD`).out.split("\n");
				const folders = [".", ...readdirSync(root).filter((name) => name.startsWith("pi-") && existsSync(join(root, name, "package.json")))];
				for (const dir of foldersToInstall(changed, folders)) {
					say(`pi-claude: aggiorno i pacchetti di ${dir === "." ? "base" : dir}…`);
					const install = run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: join(root, dir), timeout: 300_000 });
					if (!install.ok) {
						say(`  non riuscito: ${firstLine(install.err)}`);
						failed = true;
					}
				}
				done.push(`pi-claude (${claude.behind} novità)`);
			}
		}
	}

	const pi = checkPi();
	if (pi?.newer) {
		say(`Pi: da ${pi.current} a ${pi.latest}…`);
		const install = run("npm", ["install", "-g", `${PI_PACKAGE}@${pi.latest}`, "--no-audit", "--no-fund", "--loglevel=error"], { timeout: 300_000 });
		if (!install.ok) {
			say(`Pi: non riesco ad aggiornarlo (${/EACCES|permission/i.test(install.err) ? "mancano i permessi sulla cartella globale di npm" : firstLine(install.err) || "errore"}).`);
			failed = true;
		} else {
			say("Pi: controllo che parta con pi-claude…");
			if (await piLoads()) done.push(`Pi ${pi.latest}`);
			else {
				say(`Pi ${pi.latest} non carica pi-claude: rimetto la ${pi.current}.`);
				run("npm", ["install", "-g", `${PI_PACKAGE}@${pi.current}`, "--no-audit", "--no-fund", "--loglevel=error"], { timeout: 300_000 });
				failed = true;
			}
		}
	}

	say(`RISULTATO: ${done.length ? `aggiornato ${done.join(" e ")}. Riavvia Pi per usarlo.` : failed ? "non sono riuscito ad aggiornare." : "niente da aggiornare."}${done.length && failed ? " (qualcosa è rimasto indietro, vedi sopra)" : ""}`);
	process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	if (process.argv.includes("--check")) console.log(JSON.stringify({ claude: checkClaude(), pi: checkPi() }));
	else await update();
}
