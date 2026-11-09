#!/usr/bin/env node
// Launcher of `pi` for pi-claude: the new chat frontend (prototype/rpc-chat, on `pi --mode rpc`) is the default,
// the classic Pi TUI with pi-ui stays one option away: `pi --classic` or PI_UI_CLASSIC=1.
// Non-interactive uses (-p, --mode, --help, --version, --export, subcommands) and non-TTY streams always go classic.
// `node bin/pi.mjs --is-classic <args>` only prints the decision as exit code (0 = classic) for the shell functions.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLASSIC_FLAGS = new Set(["--classic", "-p", "--print", "--mode", "-h", "--help", "-v", "--version", "--export", "--list-models"]);
const SUBCOMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

/** True when the classic Pi TUI must run. */
export function isClassic(args, env = process.env, tty = Boolean(process.stdin.isTTY && process.stdout.isTTY)) {
	if (env.PI_UI_CLASSIC === "1" || env.PI_UI === "off") return true;
	if (!tty) return true;
	if (args.some((arg) => CLASSIC_FLAGS.has(arg))) return true;
	return SUBCOMMANDS.has(args.find((arg) => !arg.startsWith("-")) ?? "") && !args.some((arg) => arg.startsWith("@"));
}

export const chatPath = () => join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "prototype", "rpc-chat", "chat.mjs");

function main(argv) {
	if (argv[0] === "--is-classic") process.exit(isClassic(argv.slice(1)) ? 0 : 1);
	const env = { ...process.env };
	// -d: no permission prompts (PI_YOLO=1); no startup update checks unless PI_OFFLINE=0.
	const args = argv.filter((arg) => arg !== "-d" && arg !== "--classic");
	if (argv.includes("-d")) env.PI_YOLO = "1";
	if (env.PI_OFFLINE === "0") delete env.PI_OFFLINE;
	else env.PI_OFFLINE = "1";
	const classic = isClassic(argv, env);
	const [cmd, cmdArgs] = classic ? ["pi", args] : [process.execPath, [chatPath(), ...args]];
	const child = spawn(cmd, cmdArgs, { stdio: "inherit", env, shell: classic && process.platform === "win32" });
	child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
