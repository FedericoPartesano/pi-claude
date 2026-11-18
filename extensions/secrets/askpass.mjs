#!/usr/bin/env node
// SUDO_ASKPASS helper: asks the running Pi (over a local unix socket) for the sudo password and prints it on stdout.
// Usage (from the generated wrapper): askpass.mjs <socket> <token> <prompt>. Exit 1 = nothing sent (denied/cancelled).
import { createConnection } from "node:net";

const [sock, token, ...promptParts] = process.argv.slice(2);
if (!sock || !token) process.exit(1);
const conn = createConnection(sock);
let buf = "";
const done = (code) => { conn.destroy(); process.exit(code); };
conn.setTimeout(15000, () => done(1));
conn.on("error", () => done(1));
conn.on("connect", () => conn.write(`${JSON.stringify({ token, prompt: promptParts.join(" ") })}\n`));
conn.on("data", (chunk) => {
	buf += chunk;
	const nl = buf.indexOf("\n");
	if (nl < 0) return;
	let reply = {};
	try { reply = JSON.parse(buf.slice(0, nl)); } catch { /* ignore */ }
	if (typeof reply.password !== "string") done(1);
	process.stdout.write(`${reply.password}\n`, () => done(0));
});
