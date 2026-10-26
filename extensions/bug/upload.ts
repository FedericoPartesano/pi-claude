/** Sending a bug package: a .tar.gz of the (redacted) folder, one POST. Settings: env, then ~/.pi/agent/bug.json {url, token}. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The project's own bug server (leopart, via Tailscale Funnel). The token only keeps spam out: it is public with the repo. */
export const DEFAULT_URL = "https://leopart.burmilla-bangus.ts.net:8443/";
export const DEFAULT_TOKEN = "b65fa7f05a260164292e88ea4dc849ffe8403e28d6abf535";

export interface UploadConfig {
	url: string;
	token: string;
}

/** The server to send to, or undefined (nothing configured, or PI_BUG_UPLOAD=0). */
export function uploadConfig(env: NodeJS.ProcessEnv, home: string): UploadConfig | undefined {
	if (env.PI_BUG_UPLOAD === "0") return undefined;
	let file: { url?: unknown; token?: unknown } = {};
	try {
		file = JSON.parse(readFileSync(join(home, ".pi", "agent", "bug.json"), "utf8"));
	} catch {
		// no file: env and defaults
	}
	const url = env.PI_BUG_URL || (typeof file.url === "string" ? file.url : "") || DEFAULT_URL;
	if (!/^https?:\/\//.test(url)) return undefined;
	return { url, token: env.PI_BUG_TOKEN || (typeof file.token === "string" ? file.token : "") || DEFAULT_TOKEN };
}

/** Packs `dir` into `dir.tar.gz` next to it; returns the file path. */
export function pack(dir: string): string {
	const out = `${dir}.tar.gz`;
	const run = spawnSync("tar", ["-czf", out, "-C", dirname(dir), basename(dir)], { encoding: "utf8" });
	if (run.status !== 0) throw new Error(`tar non è riuscito: ${(run.stderr || run.error?.message || "").trim()}`);
	return out;
}

/** The server's own words ({"error": "..."}), when it gave any. */
async function serverReason(response: Response): Promise<string> {
	try {
		const text = (await response.text()).trim();
		if (!text) return "";
		const error = (JSON.parse(text) as { error?: unknown }).error;
		return typeof error === "string" ? error.slice(0, 120) : "";
	} catch {
		return "";
	}
}

export async function upload(config: UploadConfig, file: string, meta: { title: string; severity: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
	try {
		const body = readFileSync(file);
		const response = await fetchImpl(config.url, {
			method: "POST",
			headers: {
				"content-type": "application/gzip",
				...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
				"x-bug-title": encodeURIComponent(meta.title).slice(0, 300),
				"x-bug-severity": meta.severity,
				"x-bug-name": basename(file),
			},
			body,
			signal: AbortSignal.timeout(120_000),
		});
		if (response.ok) return { ok: true, message: `inviato (${Math.round(body.length / 1024)} KB)` };
		const reason = await serverReason(response);
		const sent = response.status === 413 ? `, inviati ${Math.round(body.length / 1024 / 1024)} MB` : "";
		return { ok: false, message: `il server ha risposto ${response.status}${reason ? ` (${reason})` : ""}${sent}` };
	} catch (error) {
		return { ok: false, message: `invio non riuscito: ${(error as Error).message}` };
	}
}
