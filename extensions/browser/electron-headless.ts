/**
 * A browser without a window, run by Pi itself from terminal-browser's Electron: no pane to open by hand. It is the
 * backend that works on WSL2, where Chrome never finishes a navigation. Linux only (the Electron of terminal-browser).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appRoot } from "./terminal-install.ts";

const MAIN = `const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(() => {
  const w = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { backgroundThrottling: false, offscreen: true } });
  w.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
`;

/** The Electron binary of an installed terminal-browser, if any (Linux). */
export async function electronBinary(): Promise<string | undefined> {
	if (process.platform !== "linux") return undefined;
	try {
		const binary = join(await appRoot(), "electron", "pixel");
		return existsSync(binary) ? binary : undefined;
	} catch {
		return undefined;
	}
}

export interface HeadlessElectron {
	endpoint: string;
	process: ChildProcess;
}

export async function startElectronHeadless(binary: string, root = join(homedir(), ".cache", "pi-browser", "electron")): Promise<HeadlessElectron> {
	const app = join(root, "app");
	const profile = join(root, "profile");
	mkdirSync(app, { recursive: true });
	mkdirSync(profile, { recursive: true });
	writeFileSync(join(app, "package.json"), JSON.stringify({ name: "pi-browser", main: "main.js" }));
	writeFileSync(join(app, "main.js"), MAIN);
	const portFile = join(profile, "DevToolsActivePort");
	rmSync(portFile, { force: true });
	// No sandbox: the SUID helper of an unpacked Electron is not root-owned.
	const child = spawn(binary, ["--no-sandbox", `--user-data-dir=${profile}`, "--remote-debugging-port=0", app], { stdio: "ignore", detached: false });
	const exited = new Promise<undefined>((resolve) => child.once("exit", () => resolve(undefined)));
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) break;
		try {
			const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
			if (port) return { endpoint: `http://127.0.0.1:${port}`, process: child };
		} catch {
			// Not written yet.
		}
		await Promise.race([new Promise((resolve) => setTimeout(resolve, 100)), exited]);
	}
	child.kill();
	throw new Error("Il browser senza finestra non è partito (porta di debug non scritta in 15 s).");
}
