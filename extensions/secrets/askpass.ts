/**
 * Local askpass channel: a unix socket in a private (0700) temp dir plus a tiny wrapper script for SUDO_ASKPASS.
 * The socket only ever answers while a sudo command that the user confirmed is running, and only with the sudo secret.
 * Not available on Windows (no sudo there).
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shq } from "./guard.ts";

export interface Askpass {
	/** Path to give to SUDO_ASKPASS. */
	script: string;
	/** Allow the helper to receive the password until `release` is called (one confirmed command). */
	grant(provide: () => string | undefined): () => void;
	close(): void;
}

export async function startAskpass(): Promise<Askpass | undefined> {
	if (process.platform === "win32") return undefined;
	const dir = mkdtempSync(join(tmpdir(), "pi-askpass-"));
	chmodSync(dir, 0o700);
	const sock = join(dir, "s");
	const token = randomBytes(16).toString("hex");
	let provide: (() => string | undefined) | undefined;
	const server: Server = createServer((conn) => {
		let buf = "";
		conn.setTimeout(10000, () => conn.destroy());
		conn.on("error", () => conn.destroy());
		conn.on("data", (chunk) => {
			buf += chunk;
			const nl = buf.indexOf("\n");
			if (nl < 0) return;
			let ok = false;
			try { ok = JSON.parse(buf.slice(0, nl)).token === token; } catch { /* ignore */ }
			const password = ok ? provide?.() : undefined;
			conn.end(`${JSON.stringify(password === undefined ? {} : { password })}\n`);
		});
	});
	try {
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(sock, resolve); });
	} catch {
		rmSync(dir, { recursive: true, force: true });
		return undefined;
	}
	try { chmodSync(sock, 0o600); } catch { /* best effort */ }
	server.unref();
	const helper = join(dirname(fileURLToPath(import.meta.url)), "askpass.mjs");
	const script = join(dir, "askpass.sh");
	writeFileSync(script, `#!/bin/sh\nexec ${shq(process.execPath)} ${shq(helper)} ${shq(sock)} ${shq(token)} "$@"\n`, { mode: 0o700 });
	const close = () => { server.close(); rmSync(dir, { recursive: true, force: true }); };
	process.once("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });
	return {
		script,
		grant(fn) { provide = fn; return () => { if (provide === fn) provide = undefined; }; },
		close,
	};
}
