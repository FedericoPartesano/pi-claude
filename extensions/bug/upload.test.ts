import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { DEFAULT_TOKEN, DEFAULT_URL, pack, upload, uploadConfig } from "./upload.ts";

test("uploadConfig: env, poi bug.json, poi il server predefinito; spento con PI_BUG_UPLOAD=0 o senza URL valido", () => {
	const home = mkdtempSync(join(tmpdir(), "cfg-"));
	assert.deepEqual(uploadConfig({}, home), { url: DEFAULT_URL, token: DEFAULT_TOKEN });
	mkdirSync(join(home, ".pi/agent"), { recursive: true });
	writeFileSync(join(home, ".pi/agent/bug.json"), JSON.stringify({ url: "https://leopart.example/bug", token: "t1" }));
	assert.deepEqual(uploadConfig({}, home), { url: "https://leopart.example/bug", token: "t1" });
	assert.deepEqual(uploadConfig({ PI_BUG_URL: "http://localhost:1/x", PI_BUG_TOKEN: "t2" }, home), { url: "http://localhost:1/x", token: "t2" });
	assert.equal(uploadConfig({ PI_BUG_UPLOAD: "0" }, home), undefined);
	assert.equal(uploadConfig({ PI_BUG_URL: "ftp://x" }, mkdtempSync(join(tmpdir(), "cfg-"))), undefined);
});

test("pack + upload: il server riceve un tar.gz con i file, il token e il titolo", async () => {
	const root = mkdtempSync(join(tmpdir(), "up-"));
	const dir = join(root, "2026-bug");
	mkdirSync(dir);
	writeFileSync(join(dir, "report.json"), '{"a":1}');
	const file = pack(dir);
	assert.ok(existsSync(file));
	const seen: { headers: Record<string, unknown>; body: Buffer }[] = [];
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			seen.push({ headers: request.headers, body: Buffer.concat(chunks) });
			response.statusCode = request.headers.authorization === "Bearer ok" ? 200 : 401;
			response.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
	try {
		const good = await upload({ url, token: "ok" }, file, { title: "Todo è sparita", severity: "blocca" });
		assert.equal(good.ok, true, good.message);
		assert.equal(decodeURIComponent(String(seen[0].headers["x-bug-title"])), "Todo è sparita");
		assert.match(gunzipSync(seen[0].body).toString("latin1"), /2026-bug\/report\.json/);
		const bad = await upload({ url, token: "no" }, file, { title: "x", severity: "piccolo" });
		assert.deepEqual(bad, { ok: false, message: "il server ha risposto 401" });
	} finally {
		server.close();
	}
	const down = await upload({ url: "http://127.0.0.1:1/", token: "" }, file, { title: "x", severity: "piccolo" });
	assert.equal(down.ok, false);
	assert.match(down.message, /invio non riuscito/);
});
