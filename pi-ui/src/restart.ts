/**
 * /riavvia: a full restart that reopens the same conversation. A process cannot restart itself on the same terminal, so
 * Pi writes which session and folder to reopen and quits; the launcher loop (shell/pi-riavvia.sh, bin/pi-full) reads the
 * request and starts `pi --session <file>` again in that folder.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RESTART_FILE = process.env.PI_UI_RESTART_FILE || join(homedir(), ".pi/agent/pi-ui-restart");

export interface RestartRequest {
	/** Session file to reopen; empty for a session that was never saved (--no-session): Pi then starts fresh. */
	session: string;
	cwd: string;
}

/** Plain key=value lines, so the shell loop can read them with sed. */
export function writeRestartRequest(file: string, request: RestartRequest): void {
	writeFileSync(file, `session=${request.session}\ncwd=${request.cwd}\n`);
}

export function readRestartRequest(file: string): RestartRequest | undefined {
	if (!existsSync(file)) return undefined;
	const value = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(file, "utf8"))?.[1] ?? "";
	return { session: value("session"), cwd: value("cwd") };
}

export const clearRestartRequest = (file: string) => rmSync(file, { force: true });
