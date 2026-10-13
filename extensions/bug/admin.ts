/**
 * Reading the received bugs: only the admin can, with the password of the bug server (never in the repo).
 * Login gives a token valid 12 h, kept in ~/.pi/agent/bug-admin.json (mode 600); the password itself is never saved.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Session {
	token: string;
	expiresAt: number;
}

export interface ReceivedBug {
	id: string;
	size: number;
	name?: string;
	title?: string;
	severity?: string;
	status?: "new" | "resolved";
	receivedAt?: string;
}

const sessionFile = (home: string) => join(home, ".pi", "agent", "bug-admin.json");

export function savedSession(home: string, now = Date.now()): Session | undefined {
	try {
		const data = JSON.parse(readFileSync(sessionFile(home), "utf8")) as Partial<Session>;
		return typeof data.token === "string" && typeof data.expiresAt === "number" && data.expiresAt > now + 60_000 ? (data as Session) : undefined;
	} catch {
		return undefined;
	}
}

export function saveSession(home: string, session: Session): void {
	const file = sessionFile(home);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
	chmodSync(file, 0o600);
}

/** The admin's own computer may keep the password in ~/.pi/agent/bug-admin-password (mode 600): then /bugs asks for nothing. */
export function savedPassword(home: string): string | undefined {
	try {
		return readFileSync(join(home, ".pi", "agent", "bug-admin-password"), "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

const base = (url: string) => url.replace(/\/+$/, "");

export async function login(url: string, password: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; session: Session } | { ok: false; message: string }> {
	try {
		const response = await fetchImpl(`${base(url)}/admin/login`, { method: "POST", body: JSON.stringify({ password }), signal: AbortSignal.timeout(20_000) });
		if (response.ok) return { ok: true, session: (await response.json()) as Session };
		const error = ((await response.json().catch(() => ({}))) as { error?: string }).error;
		return { ok: false, message: error ?? `il server ha risposto ${response.status}` };
	} catch (error) {
		return { ok: false, message: `server non raggiungibile: ${(error as Error).message}` };
	}
}

/** The list, or "login" when the token is no longer valid. */
export async function listBugs(url: string, session: Session, fetchImpl: typeof fetch = fetch): Promise<{ bugs: ReceivedBug[] } | "login" | { error: string }> {
	try {
		const response = await fetchImpl(`${base(url)}/admin/bugs`, { headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(20_000) });
		if (response.status === 401) return "login";
		if (!response.ok) return { error: `il server ha risposto ${response.status}` };
		return { bugs: ((await response.json()) as { bugs: ReceivedBug[] }).bugs };
	} catch (error) {
		return { error: `server non raggiungibile: ${(error as Error).message}` };
	}
}

/** Downloads one package into `dir`; returns the file path. */
export async function downloadBug(url: string, session: Session, bug: ReceivedBug, dir: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const response = await fetchImpl(`${base(url)}/admin/bugs/${encodeURIComponent(bug.id)}`, { headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(120_000) });
	if (!response.ok) throw new Error(`il server ha risposto ${response.status}`);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${(bug.name ?? bug.id).replace(/[^\w.-]/g, "_")}`);
	const target = existsSync(file) ? file.replace(/(\.tar\.gz)?$/, `-${bug.id.slice(-6)}$1`) : file;
	writeFileSync(target, Buffer.from(await response.arrayBuffer()));
	return target;
}

export const bugLabel = (bug: ReceivedBug) =>
	`${(bug.receivedAt ?? "").slice(0, 16).replace("T", " ")} · ${bug.severity || "?"} · ${bug.title || bug.name || bug.id} · ${Math.round(bug.size / 1024)} KB`;

const withAuth = (session: Session, extra: RequestInit = {}): RequestInit => ({ ...extra, headers: { authorization: `Bearer ${session.token}`, ...(extra.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });

/** Marks a bug "new" or "resolved" on the server. */
export async function setBugStatus(url: string, session: Session, id: string, status: "new" | "resolved", fetchImpl: typeof fetch = fetch): Promise<number> {
	return (await fetchImpl(`${base(url)}/admin/bugs/${encodeURIComponent(id)}`, withAuth(session, { method: "PATCH", body: JSON.stringify({ status }) }))).status;
}

/** Deletes a bug from the server database. */
export async function deleteBug(url: string, session: Session, id: string, fetchImpl: typeof fetch = fetch): Promise<number> {
	return (await fetchImpl(`${base(url)}/admin/bugs/${encodeURIComponent(id)}`, withAuth(session, { method: "DELETE" }))).status;
}
