/**
 * The HTTP side of the bug server, with no database in it: `storage` is passed in (see storage.mjs; tests use a memory one).
 *   POST /        body = .tar.gz, header Authorization: Bearer <token>   → 201 {id}
 *   GET  /health  → 200 ok
 * Only the admin reads: with adminPassword set, POST /admin/login {password} → {token, expiresAt} (12 h, kept in memory,
 * 5 wrong passwords per IP per 15 min then 429), GET /admin/bugs (list, with status new|resolved), GET /admin/bugs/:id (the .tar.gz),
 * PATCH /admin/bugs/:id {status}, DELETE /admin/bugs/:id, all with Authorization: Bearer <admin token>. Without adminPassword there is no way to read through HTTP.
 * Limits: size per package, packages per hour per IP, total disk quota (oldest packages are deleted first).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const sha = (text) => createHash("sha256").update(String(text)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
const ADMIN_HOURS = 12;

export function createApp({ storage, token, adminPassword = "", maxBytes = 250 * 1024 * 1024, perHour = 10, quotaBytes = 2 * 1024 ** 3, now = () => Date.now() }) {
	const hits = new Map(); // ip → timestamps in the last hour

	const tooMany = (ip) => {
		const recent = (hits.get(ip) ?? []).filter((t) => now() - t < 3_600_000);
		hits.set(ip, recent);
		if (recent.length >= perHour) return true;
		recent.push(now());
		return false;
	};

	const sessions = new Map(); // admin token → expiry (ms)
	const failures = new Map(); // ip → timestamps of wrong passwords in the last 15 min
	const locked = (ip) => (failures.get(ip) ?? []).filter((t) => now() - t < 900_000).length >= 5;
	const failed = (ip) => failures.set(ip, [...(failures.get(ip) ?? []).filter((t) => now() - t < 900_000), now()]);
	const isAdmin = (request) => {
		const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
		const expiry = bearer ? sessions.get(bearer) : undefined;
		if (expiry === undefined) return false;
		if (expiry < now()) return sessions.delete(bearer) && false;
		return true;
	};
	const readBody = async (request, limit = 2048) => {
		let text = "";
		for await (const chunk of request) {
			text += chunk;
			if (text.length > limit) return undefined;
		}
		return text;
	};

	const send = (response, status, body) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};

	return createServer(async (request, response) => {
		const ip = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",")[0].trim();
		if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
		if (request.url?.startsWith("/admin/")) {
			if (!adminPassword) return send(response, 404, { error: "non trovato" });
			if (request.method === "POST" && request.url === "/admin/login") {
				if (locked(ip)) return send(response, 429, { error: "troppi tentativi, riprova tra 15 minuti" });
				let password;
				try {
					password = JSON.parse((await readBody(request)) ?? "").password;
				} catch {
					return send(response, 400, { error: "richiesta non valida" });
				}
				if (typeof password !== "string" || !same(password, adminPassword)) {
					failed(ip);
					return send(response, 401, { error: "password sbagliata" });
				}
				const session = randomBytes(32).toString("hex");
				const expiresAt = now() + ADMIN_HOURS * 3_600_000;
				sessions.set(session, expiresAt);
				return send(response, 200, { token: session, expiresAt });
			}
			if (!isAdmin(request)) return send(response, 401, { error: "accesso negato" });
			if (request.method === "GET" && request.url === "/admin/bugs") return send(response, 200, { bugs: await storage.list(200) });
			const id = /^\/admin\/bugs\/([\w-]{1,40})$/.exec(request.url)?.[1];
			if (!id) return send(response, 404, { error: "non trovato" });
			if (request.method === "GET") {
				const found = await storage.open(id);
				if (!found) return send(response, 404, { error: "non trovato" });
				response.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="${found.name}"` });
				found.stream.pipe(response);
				return;
			}
			if (request.method === "DELETE") return (await storage.removeById(id)) ? send(response, 200, { ok: true }) : send(response, 404, { error: "non trovato" });
			if (request.method === "PATCH") {
				let status;
				try {
					status = JSON.parse((await readBody(request)) ?? "").status;
				} catch {
					return send(response, 400, { error: "richiesta non valida" });
				}
				if (status !== "new" && status !== "resolved") return send(response, 400, { error: "stato non valido: new o resolved" });
				return (await storage.setStatus(id, status)) ? send(response, 200, { ok: true }) : send(response, 404, { error: "non trovato" });
			}
			return send(response, 404, { error: "non trovato" });
		}
		if (request.method !== "POST" || request.url !== "/") return send(response, 404, { error: "non trovato" });
		if (token && request.headers.authorization !== `Bearer ${token}`) return send(response, 401, { error: "token non valido" });
		const declared = Number(request.headers["content-length"] ?? 0);
		if (declared > maxBytes) return send(response, 413, { error: "pacchetto troppo grande" });
		if (tooMany(ip)) return send(response, 429, { error: "troppi invii, riprova più tardi" });

		let size = 0;
		let tooBig = false;
		const counted = async function* () {
			for await (const chunk of request) {
				size += chunk.length;
				if (size > maxBytes) {
					tooBig = true;
					return;
				}
				yield chunk;
			}
		};
		const meta = {
			title: decodeURIComponent(String(request.headers["x-bug-title"] ?? "")).slice(0, 300),
			severity: String(request.headers["x-bug-severity"] ?? "").slice(0, 20),
			name: String(request.headers["x-bug-name"] ?? "").replace(/[^\w.-]/g, "_").slice(0, 120),
			ip,
			receivedAt: new Date(now()),
		};
		try {
			const id = await storage.save(counted(), meta);
			if (tooBig) {
				await storage.remove(id);
				return send(response, 413, { error: "pacchetto troppo grande" });
			}
			let used = await storage.usage();
			while (used > quotaBytes && (await storage.removeOldest(id))) used = await storage.usage();
			send(response, 201, { id: String(id) });
		} catch (error) {
			console.error("salvataggio non riuscito:", error);
			send(response, 500, { error: "salvataggio non riuscito" });
		}
	});
}
