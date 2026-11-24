#!/usr/bin/env node
// Launcher of `pi` for pi-claude: the new chat frontend (prototype/rpc-chat, on `pi --mode rpc`) is the default,
// the classic Pi TUI with pi-ui stays one option away: `pi --classic` or PI_UI_CLASSIC=1.
// Non-interactive uses (-p, --mode, --help, --version, --export, subcommands) and non-TTY streams always go classic.
// `node bin/pi.mjs --is-classic <args>` only prints the decision as exit code (0 = classic) for the shell functions.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLASSIC_FLAGS = new Set(["--classic", "-p", "--print", "--mode", "-h", "--help", "-v", "--version", "--export", "--list-models"]);
const SUBCOMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

/** True when the classic Pi TUI must run. */
export function isClassic(args, env = process.env, tty = Boolean(process.stdin.isTTY && process.stdout.isTTY)) {
	if (args[0] === "doctor") return false;
	if (env.PI_UI_CLASSIC === "1" || env.PI_UI === "off") return true;
	if (!tty) return true;
	if (args.some((arg) => CLASSIC_FLAGS.has(arg))) return true;
	return SUBCOMMANDS.has(args.find((arg) => !arg.startsWith("-")) ?? "") && !args.some((arg) => arg.startsWith("@"));
}

/**
 * Sub-agents in plain `pi`: the upstream `subagent` extension, pi-team and tool-groups (last), all loaded with their tools OFF
 * (the model turns them on with load_tools), so the fixed prompt only grows by the small load_tools entry.
 * Skipped when the pieces are missing, for subcommands and when PI_SUBAGENTS=off. pi-full passes its own -e list and does not use this.
 */
export function subagentArgs(args, env = process.env, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
	if (env.PI_SUBAGENTS === "off" || args.includes("-e") || args.includes("--extension")) return [];
	if (SUBCOMMANDS.has(args.find((arg) => !arg.startsWith("-")) ?? "") && !args.some((arg) => arg.startsWith("@"))) return [];
	const agent = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const paths = [join(agent, "optional-extensions", "subagent", "index.ts"), join(root, "pi-team"), join(root, "extensions", "tool-groups.ts")];
	if (!paths.every((p) => existsSync(p))) return [];
	return paths.flatMap((p) => ["-e", p]);
}

export const chatPath = () => join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "prototype", "rpc-chat", "chat.mjs");

function main(argv) {
	if (argv[0] === "--is-classic") process.exit(isClassic(argv.slice(1)) ? 0 : 1);
	if (argv[0] === "secret") {
		// `pi secret add|list|rm`: store management from a shell, typed secrets never echoed.
		import("../extensions/secrets/cli.ts").then(async (m) => { try { process.exit(await m.runCli(argv.slice(1), m.terminalIO())); } catch (e) { console.error(String(e?.message ?? e)); process.exit(1); } });
		return;
	}
	if (argv[0] === "doctor") {
		// `pi doctor`: checks what pi-claude needs and installs what is missing (bin/pi-doctor.mjs).
		const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "pi-doctor.mjs"), ...argv.slice(1)], { stdio: "inherit" });
		child.on("exit", (code) => process.exit(code ?? 1));
		return;
	}
	const env = { ...process.env };
	// -d: no permission prompts (PI_YOLO=1); no startup update checks unless PI_OFFLINE=0.
	const args = argv.filter((arg) => arg !== "-d" && arg !== "--classic");
	const extra = subagentArgs(args, env);
	if (extra.length) { args.push(...extra); env.PI_TOOL_GROUPS ??= "subagent,team,parallel"; }
	if (argv.includes("-d")) env.PI_YOLO = "1";
	if (env.PI_OFFLINE === "0") delete env.PI_OFFLINE;
	else env.PI_OFFLINE = "1";
	const classic = isClassic(argv, env);
	const [cmd, cmdArgs] = classic ? ["pi", args] : [process.execPath, [chatPath(), ...args]];
	const child = spawn(cmd, cmdArgs, { stdio: "inherit", env, shell: classic && process.platform === "win32" });
	child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
