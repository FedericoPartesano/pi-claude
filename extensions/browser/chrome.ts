/**
 * Which Chrome Pi drives. PI_BROWSER_CDP=<http endpoint>: the user's own Chrome (started with remote debugging, their
 * logins). Otherwise a Chrome Pi starts: its own persistent profile (~/.cache/pi-browser/profile), a real window in app
 * mode (no toolbars) the user watches next to the terminal; PI_BROWSER_HEADLESS=1 for no window (tests, servers).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
	process.env.PI_BROWSER_CHROME,
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/snap/bin/chromium",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((path): path is string => Boolean(path));

export function findChrome(exists: (path: string) => boolean = existsSync): string | undefined {
	return CANDIDATES.find((path) => exists(path));
}

export interface ChromeArgsOptions {
	profile: string;
	headless: boolean;
	width?: number;
	height?: number;
}

/** Port 0: Chrome picks a free one and writes it to DevToolsActivePort in the profile. */
export function chromeArgs(options: ChromeArgsOptions): string[] {
	return [
		"--remote-debugging-port=0",
		`--user-data-dir=${options.profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate",
		`--window-size=${options.width ?? 1100},${options.height ?? 900}`,
		...(options.headless ? ["--headless=new"] : ["--app=data:text/html,<title>pi-browser</title>"]),
	];
}

export interface RunningChrome {
	endpoint: string;
	/** Undefined when attached to the user's Chrome (never closed by Pi). */
	process?: ChildProcess;
	attached: boolean;
}

export const DEFAULT_PROFILE = join(homedir(), ".cache", "pi-browser", "profile");

async function readPort(profile: string, timeoutMs: number): Promise<number | undefined> {
	const file = join(profile, "DevToolsActivePort");
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const port = Number(readFileSync(file, "utf8").split("\n")[0]);
			if (port > 0) return port;
		} catch {
			// Not written yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return undefined;
}

export async function startChrome(options: { profile?: string; headless?: boolean; endpoint?: string } = {}): Promise<RunningChrome> {
	const endpoint = options.endpoint ?? process.env.PI_BROWSER_CDP;
	if (endpoint) {
		const base = endpoint.replace(/\/+$/, "");
		await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(3000) }).catch(() => {
			throw new Error(`Nessun Chrome su ${base}: avvialo con --remote-debugging-port, oppure togli PI_BROWSER_CDP per usare il Chrome di Pi.`);
		});
		return { endpoint: base, attached: true };
	}
	const binary = findChrome();
	if (!binary) throw new Error("Chrome non trovato: installalo, oppure indica il percorso con PI_BROWSER_CHROME.");
	const profile = options.profile ?? process.env.PI_BROWSER_PROFILE ?? DEFAULT_PROFILE;
	mkdirSync(profile, { recursive: true });
	rmSync(join(profile, "DevToolsActivePort"), { force: true });
	const headless = options.headless ?? process.env.PI_BROWSER_HEADLESS === "1";
	const child = spawn(binary, chromeArgs({ profile, headless }), { stdio: "ignore", detached: false });
	const exited = new Promise<undefined>((resolve) => child.once("exit", () => resolve(undefined)));
	const port = await Promise.race([readPort(profile, 15_000), exited]);
	if (!port) {
		child.kill();
		throw new Error("Chrome non è partito (porta di debug non scritta in 15 s). Se un altro Chrome usa lo stesso profilo, chiudilo.");
	}
	return { endpoint: `http://127.0.0.1:${port}`, process: child, attached: false };
}
