/**
 * terminal-browser (https://github.com/zenbu-labs/terminal-browser) as the page Pi drives: an Electron browser drawn
 * inside the user's terminal with kitty graphics. Pi does not start it (it needs a real terminal): it attaches to the
 * one the user already opened, through its CDP port, exactly like PI_BROWSER_CDP. PI_BROWSER_BACKEND=chrome never uses
 * it; =terminal requires it. Not available on native Windows (upstream has no Windows build).
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

export interface TerminalBrowserInfo {
	key: string;
	endpoint: string;
	/** The tab the user sees: Pi drives that one, not another. */
	targetId?: string;
}

/** `terminal-browser ls --all --json` → the browser to attach to: the one in this terminal tab, else the first. */
export function parseBrowsers(json: string): TerminalBrowserInfo | undefined {
	let data: any;
	try {
		data = JSON.parse(json);
	} catch {
		return undefined;
	}
	const list: any[] = Array.isArray(data?.browsers) ? data.browsers : [];
	const usable = list.filter((browser) => Number(browser?.cdpPort) > 0);
	const pick = usable.find((browser) => browser.inCurrentTab) ?? usable[0];
	if (!pick) return undefined;
	const tabs: any[] = Array.isArray(pick.tabs) ? pick.tabs : [];
	const active = tabs.find((tab) => tab.active) ?? tabs[0];
	return { key: String(pick.key), endpoint: `http://127.0.0.1:${pick.cdpPort}`, targetId: active?.targetId };
}

export type Runner = (file: string, args: string[]) => Promise<string>;

const run: Runner = (file, args) =>
	new Promise((resolve, reject) => {
		execFile(file, args, { timeout: 8000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
	});

/** The browser the user has open, or undefined (not installed, not running, native Windows). */
export async function findTerminalBrowser(runner: Runner = run, platform: string = process.platform): Promise<TerminalBrowserInfo | undefined> {
	if (platform === "win32" || process.env.PI_BROWSER_BACKEND === "chrome") return undefined;
	try {
		return parseBrowsers(await runner("terminal-browser", ["ls", "--all", "--json"]));
	} catch {
		return undefined;
	}
}

export async function terminalBrowserInstalled(runner: Runner = run): Promise<boolean> {
	try {
		await runner("terminal-browser", ["--version"]);
		return true;
	} catch {
		return false;
	}
}

/** WSL2: Electron 44 never finishes a navigation there (verified), Electron 40 does. */
export function isWsl(procVersion: string = readProcVersion()): boolean {
	return /microsoft/i.test(procVersion);
}

function readProcVersion(): string {
	try {
		return readFileSync("/proc/version", "utf8");
	} catch {
		return "";
	}
}

export const WSL_ELECTRON_VERSION = "40.10.6";

/** The release file for this CPU, or undefined where terminal-browser has no Linux build. */
export function electronAsset(arch: string = process.arch): string | undefined {
	const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : undefined;
	return cpu ? `electron-v${WSL_ELECTRON_VERSION}-linux-${cpu}.zip` : undefined;
}

/** The sha256 of `file` from an Electron SHASUMS256.txt, if listed. */
export function shaFor(sums: string, file: string): string | undefined {
	for (const line of sums.split("\n")) {
		const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
		if (match && match[2] === file) return match[1];
	}
	return undefined;
}
