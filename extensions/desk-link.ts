/**
 * desk-link: lets Pi Desk write into a Pi running in a terminal. Each interactive Pi listens on a private local socket
 * (~/.pi/agent/desk/<pid>.sock, owner only; a named pipe on Windows). A message received there is delivered as if typed
 * in that terminal: it starts a turn, or is queued as a follow-up while Pi works. Writing into another Pi's session
 * file instead would corrupt it. No tool and no prompt text: zero tokens. PI_DESK_LINK=0 turns it off.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const LINK_DIR = join(homedir(), ".pi", "agent", "desk");

export function socketPath(pid: number, dir = LINK_DIR): string {
	return process.platform === "win32" ? `\\\\.\\pipe\\pi-desk-${pid}` : join(dir, `${pid}.sock`);
}

export interface LinkInfo {
	pid: number;
	cwd: string;
	session?: string;
	busy: boolean;
}

/** One request line → one reply. `send` delivers a user message (queued as a follow-up when Pi is busy). */
export function handleLine(line: string, deps: { info: () => LinkInfo; send: (text: string, busy: boolean) => void }): object {
	let request: { type?: string; text?: unknown };
	try {
		request = JSON.parse(line);
	} catch {
		return { type: "error", error: "richiesta non valida" };
	}
	if (request.type === "hello") return { type: "hello", ...deps.info() };
	if (request.type === "prompt") {
		const text = typeof request.text === "string" ? request.text.trim() : "";
		if (!text) return { type: "error", error: "messaggio vuoto" };
		const { busy } = deps.info();
		deps.send(text, busy);
		return { type: "ok", queued: busy };
	}
	return { type: "error", error: `richiesta sconosciuta: ${request.type}` };
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** Sockets left by Pis that are gone. */
export function cleanStale(dir = LINK_DIR): void {
	if (process.platform === "win32" || !existsSync(dir)) return;
	for (const file of readdirSync(dir)) {
		const pid = Number(/^(\d+)\.sock$/.exec(file)?.[1]);
		if (pid && !alive(pid)) rmSync(join(dir, file), { force: true });
	}
}

export function startLink(deps: { info: () => LinkInfo; send: (text: string, busy: boolean) => void }, dir = LINK_DIR): { server: Server; path: string } {
	const path = socketPath(process.pid, dir);
	if (process.platform !== "win32") {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		cleanStale(dir);
		rmSync(path, { force: true });
	}
	const server = createServer((socket) => {
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let end: number;
			while ((end = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				if (line.trim()) socket.write(`${JSON.stringify(handleLine(line, deps))}\n`);
			}
		});
		socket.on("error", () => undefined);
	});
	server.on("error", () => undefined);
	server.listen(path, () => {
		if (process.platform !== "win32") chmodSync(path, 0o600);
	});
	return { server, path };
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_DESK_LINK === "0") return;
	let link: { server: Server; path: string } | undefined;
	let current: ExtensionContext | undefined;
	let busy = false;
	pi.on("agent_start", () => {
		busy = true;
	});
	pi.on("agent_settled", () => {
		busy = false;
	});
	pi.on("session_start", (_event, ctx) => {
		current = ctx;
		// Only a Pi someone is looking at in a terminal: not print mode, not Pi Desk's own RPC child.
		if (link || ctx.mode !== "tui") return;
		link = startLink({
			info: () => {
				let session: string | undefined;
				try {
					session = current?.sessionManager.getSessionFile();
				} catch {
					session = undefined;
				}
				return { pid: process.pid, cwd: current?.cwd ?? process.cwd(), session, busy };
			},
			send: (text, isBusy) => {
				if (current?.hasUI) current.ui.notify("✉ messaggio da Pi Desk", "info");
				pi.sendUserMessage(text, isBusy ? { deliverAs: "followUp" } : undefined);
			},
		});
	});
	pi.on("session_shutdown", () => {
		if (!link) return;
		link.server.close();
		if (process.platform !== "win32") rmSync(link.path, { force: true });
		link = undefined;
	});
}
