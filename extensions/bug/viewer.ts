/**
 * A temporary local page to read the received bugs (/bugs): a server on 127.0.0.1 only, on a random port, behind a
 * random key in the URL, closed after 30 minutes without use or with the page's "Chiudi" button. It talks to the bug
 * server as the admin (list, status, delete) and unpacks each package it opens under ~/.pi/bugs/received/<id>/.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { deleteBug, listBugs, setBugStatus, type Session } from "./admin.ts";
import { readPackage } from "./package-view.ts";

export interface ViewerOptions {
	url: string;
	session: Session;
	/** Called when the server says the login expired: a new session, or undefined. */
	relogin: () => Promise<Session | undefined>;
	cacheDir: string;
	idleMs?: number;
	fetchImpl?: typeof fetch;
}

export interface Viewer {
	url: string;
	server: Server;
	close: () => void;
}

const HTML = () => readFileSync(new URL("./viewer.html", import.meta.url), "utf8");

export async function startViewer(options: ViewerOptions): Promise<Viewer> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const key = randomBytes(18).toString("hex");
	let session = options.session;
	let idle: ReturnType<typeof setTimeout>;
	const touch = () => {
		clearTimeout(idle);
		idle = setTimeout(() => viewer.close(), options.idleMs ?? 30 * 60_000);
		idle.unref?.();
	};

	const authed = async <T extends { status?: number } | unknown>(run: (session: Session) => Promise<T>, expired: (value: T) => boolean): Promise<T> => {
		const first = await run(session);
		if (!expired(first)) return first;
		const next = await options.relogin();
		if (!next) return first;
		session = next;
		return run(session);
	};

	const send = (response: ServerResponse, status: number, body: unknown) => {
		response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(JSON.stringify(body));
	};
	const readJsonBody = async (request: IncomingMessage) => {
		let text = "";
		for await (const chunk of request) {
			text += chunk;
			if (text.length > 4096) return undefined;
		}
		try {
			return JSON.parse(text);
		} catch {
			return undefined;
		}
	};

	/** The package's .tar.gz, from the cache or the server. */
	const tarball = async (id: string): Promise<string | undefined> => {
		mkdirSync(options.cacheDir, { recursive: true });
		const file = join(options.cacheDir, `${id}.tar.gz`);
		if (existsSync(file)) return file;
		const response = await authed(
			(current) => fetchImpl(`${options.url.replace(/\/+$/, "")}/admin/bugs/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${current.token}` }, signal: AbortSignal.timeout(120_000) }),
			(value) => value.status === 401,
		);
		if (!response.ok) return undefined;
		writeFileSync(file, Buffer.from(await response.arrayBuffer()));
		return file;
	};
	const unpacked = async (id: string): Promise<string | undefined> => {
		const target = join(options.cacheDir, id);
		if (!existsSync(target)) {
			const file = await tarball(id);
			if (!file) return undefined;
			mkdirSync(target, { recursive: true });
			const run = spawnSync("tar", ["-xzf", file, "-C", target, "--no-same-owner", "--no-same-permissions"], { encoding: "utf8" });
			if (run.status !== 0) {
				rmSync(target, { recursive: true, force: true });
				throw new Error(`pacchetto non leggibile: ${(run.stderr || "").trim()}`);
			}
		}
		const inner = readdirSync(target, { withFileTypes: true }).find((entry) => entry.isDirectory());
		return inner ? join(target, inner.name) : target;
	};

	const server = createServer(async (request, response) => {
		touch();
		const port = (server.address() as AddressInfo).port;
		// Only this page on this computer: a wrong Host (DNS rebinding) or a missing key gets nothing.
		if (request.headers.host !== `127.0.0.1:${port}`) return send(response, 403, { error: "host non valido" });
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
		try {
			if (request.method === "GET" && url.pathname === "/") {
				if (url.searchParams.get("k") !== key) return send(response, 403, { error: "chiave mancante: usa il link che ha aperto Pi" });
				response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
				return void response.end(HTML().replace("__KEY__", key));
			}
			if (request.headers["x-viewer-key"] !== key) return send(response, 403, { error: "chiave non valida" });
			if (request.method === "POST" && url.pathname === "/api/quit") {
				send(response, 200, { ok: true });
				return void setTimeout(() => viewer.close(), 50);
			}
			if (request.method === "GET" && url.pathname === "/api/bugs") {
				const result = await authed((current) => listBugs(options.url, current, fetchImpl), (value) => value === "login");
				if (result === "login") return send(response, 401, { error: "accesso scaduto: rilancia /bugs" });
				if ("error" in result) return send(response, 502, result);
				return send(response, 200, result);
			}
			const match = /^\/api\/bugs\/([\w-]{1,40})(\/download|\/status)?$/.exec(url.pathname);
			if (!match) return send(response, 404, { error: "non trovato" });
			const id = match[1];
			if (request.method === "GET" && !match[2]) {
				const dir = await unpacked(id);
				return dir ? send(response, 200, readPackage(dir)) : send(response, 404, { error: "pacchetto non trovato sul server" });
			}
			if (request.method === "GET" && match[2] === "/download") {
				const file = await tarball(id);
				if (!file) return send(response, 404, { error: "pacchetto non trovato" });
				response.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="bug-${id}.tar.gz"` });
				return void response.end(readFileSync(file));
			}
			if (request.method === "POST" && match[2] === "/status") {
				const body = (await readJsonBody(request)) as { status?: string } | undefined;
				if (body?.status !== "new" && body?.status !== "resolved") return send(response, 400, { error: "stato non valido" });
				const code = await authed((current) => setBugStatus(options.url, current, id, body.status as "new" | "resolved", fetchImpl), (value) => value === 401);
				return send(response, code === 200 ? 200 : code, code === 200 ? { ok: true } : { error: `il server ha risposto ${code}` });
			}
			if (request.method === "DELETE" && !match[2]) {
				const code = await authed((current) => deleteBug(options.url, current, id, fetchImpl), (value) => value === 401);
				if (code === 200) {
					rmSync(join(options.cacheDir, id), { recursive: true, force: true });
					rmSync(join(options.cacheDir, `${id}.tar.gz`), { force: true });
				}
				return send(response, code === 200 ? 200 : code, code === 200 ? { ok: true } : { error: `il server ha risposto ${code}` });
			}
			return send(response, 404, { error: "non trovato" });
		} catch (error) {
			send(response, 500, { error: (error as Error).message });
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const viewer: Viewer = {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?k=${key}`,
		server,
		close: () => {
			clearTimeout(idle);
			server.closeAllConnections?.();
			server.close();
		},
	};
	touch();
	return viewer;
}

/** Opens a URL in the default browser (WSL, Linux, macOS, Windows). Returns false when no way worked. */
export function openInBrowser(url: string): boolean {
	const tries: [string, string[]][] =
		process.platform === "darwin" ? [["open", [url]]]
		: process.platform === "win32" ? [["cmd.exe", ["/c", "start", "", url.replace(/&/g, "^&")]]]
		: [["wslview", [url]], ["xdg-open", [url]], ["cmd.exe", ["/c", "start", "", url.replace(/&/g, "^&")]]];
	for (const [command, args] of tries) {
		const run = spawnSync(command, args, { stdio: "ignore", timeout: 8000 });
		if (!run.error && (run.status === 0 || command === "cmd.exe")) return true;
	}
	return false;
}
