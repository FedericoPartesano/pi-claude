/** Client side of desk-link (extensions/desk-link.ts): one request to the Pi running as `pid`, one reply. */
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export const socketPath = (pid, dir = join(homedir(), ".pi", "agent", "desk")) => (process.platform === "win32" ? `\\\\.\\pipe\\pi-desk-${pid}` : join(dir, `${pid}.sock`));

export function linkRequest(pid, request, { dir, timeoutMs = 3000 } = {}) {
	return new Promise((resolve, reject) => {
		const socket = connect(socketPath(pid, dir));
		let buffer = "";
		const timer = setTimeout(() => (socket.destroy(), reject(new Error("il Pi non risponde"))), timeoutMs);
		socket.setEncoding("utf8");
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on("data", (chunk) => {
			buffer += chunk;
			const end = buffer.indexOf("\n");
			if (end === -1) return;
			clearTimeout(timer);
			socket.end();
			const reply = JSON.parse(buffer.slice(0, end));
			if (reply.type === "error") reject(new Error(reply.error));
			else resolve(reply);
		});
		socket.on("error", (error) => {
			clearTimeout(timer);
			reject(new Error(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "questo Pi non ha desk-link: riavvialo per poterci scrivere" : error.message));
		});
	});
}
