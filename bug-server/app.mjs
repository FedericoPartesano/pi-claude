/**
 * The HTTP side of the bug server, with no database in it: `storage` is passed in (see storage.mjs; tests use a memory one).
 *   POST /        body = .tar.gz, header Authorization: Bearer <token>   → 201 {id}
 *   GET  /health  → 200 ok
 * Limits: size per package, packages per hour per IP, total disk quota (oldest packages are deleted first).
 */
import { createServer } from "node:http";

export function createApp({ storage, token, maxBytes = 50 * 1024 * 1024, perHour = 10, quotaBytes = 2 * 1024 ** 3, now = () => Date.now() }) {
	const hits = new Map(); // ip → timestamps in the last hour

	const tooMany = (ip) => {
		const recent = (hits.get(ip) ?? []).filter((t) => now() - t < 3_600_000);
		hits.set(ip, recent);
		if (recent.length >= perHour) return true;
		recent.push(now());
		return false;
	};

	const send = (response, status, body) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};

	return createServer(async (request, response) => {
		const ip = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",")[0].trim();
		if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
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
