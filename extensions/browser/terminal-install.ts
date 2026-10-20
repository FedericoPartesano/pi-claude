/**
 * `/browser installa`: installs terminal-browser and, on WSL2, swaps its Electron 44 for 40 (44 never finishes a
 * navigation there). Every step asks first (confirm) and nothing runs on its own. Native Windows: not supported.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { electronAsset, isWsl, shaFor, terminalBrowserInstalled, WSL_ELECTRON_VERSION } from "./terminal-browser.ts";

export const INSTALL_URL = "https://terminal-browser.sh/install";
const RELEASE = `https://github.com/electron/electron/releases/download/v${WSL_ELECTRON_VERSION}`;

export interface InstallUi {
	confirm(title: string, message: string): Promise<boolean>;
	notify(message: string): void;
}

const sh = (file: string, args: string[], env: Record<string, string> = {}, timeoutMs = 300_000): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(file, args, { timeout: timeoutMs, env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
			error ? reject(new Error((stderr || error.message).trim().split("\n").slice(-3).join(" "))) : resolve(stdout),
		);
	});

async function download(url: string): Promise<Buffer> {
	const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

async function unzip(zip: string, into: string): Promise<void> {
	try {
		await sh("unzip", ["-q", zip, "-d", into]);
	} catch {
		await sh("python3", ["-I", "-m", "zipfile", "-e", zip, into]);
	}
}

/** The command on PATH may be a wrapper (`exec "<root>/bin/terminal-browser" "$@"`): follow it to the real binary. */
export function binaryOf(file: string, text: string): string {
	return /^\s*exec\s+"([^"]+)"/m.exec(text)?.[1] ?? file;
}

/** The terminal-browser root (the folder holding bin/ and electron/). */
export async function appRoot(): Promise<string> {
	const found = (await sh("sh", ["-c", "command -v terminal-browser"])).trim();
	let text = "";
	try {
		text = readFileSync(found, "utf8");
	} catch {
		// A binary, not a script.
	}
	return dirname(dirname(realpathSync(binaryOf(found, text))));
}

export async function installTerminalBrowser(ui: InstallUi): Promise<string> {
	if (process.platform === "win32") return "terminal-browser non esiste per Windows nativo: usa WSL, macOS o Linux.";
	if (!(await terminalBrowserInstalled())) {
		const ok = await ui.confirm("terminal-browser", `Scarico ed eseguo lo script di installazione da ${INSTALL_URL} (installa in ~/.local, senza toccare la configurazione degli agenti)?`);
		if (!ok) return "Installazione annullata.";
		const dir = mkdtempSync(join(tmpdir(), "tb-install-"));
		try {
			const script = join(dir, "install.sh");
			writeFileSync(script, await download(INSTALL_URL));
			chmodSync(script, 0o700);
			await sh("sh", [script], { TERMINAL_BROWSER_SKIP_SETUP: "1" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		if (!(await terminalBrowserInstalled())) return "Installato, ma `terminal-browser` non è nel PATH: aggiungi ~/.local/bin e riapri il terminale.";
		ui.notify("terminal-browser installato.");
	}
	if (!isWsl()) return "terminal-browser pronto. Aprilo in un pannello del terminale: terminal-browser open <url>.";
	const root = await appRoot();
	const current = await sh(join(root, "electron", "pixel"), ["-e", "console.log(process.versions.electron)"], { ELECTRON_RUN_AS_NODE: "1" }).catch(() => "");
	if (current.trim().startsWith(`${WSL_ELECTRON_VERSION.split(".")[0]}.`)) return `terminal-browser pronto (Electron ${current.trim()}). Aprilo in un pannello: terminal-browser open <url>.`;
	const asset = electronAsset();
	if (!asset) return `Su WSL serve Electron ${WSL_ELECTRON_VERSION} ma non ho un build per ${process.arch}: sostituiscilo a mano.`;
	const ok = await ui.confirm(
		"terminal-browser su WSL",
		`Su WSL2 l'Electron incluso (${current.trim() || "44"}) non completa le navigazioni. Lo sostituisco con ${WSL_ELECTRON_VERSION} da github.com/electron (controllo SHA256), tenendo l'originale in ${join(root, "electron.orig")}. Un upgrade di terminal-browser rimette l'originale. Procedo?`,
	);
	if (!ok) return "terminal-browser installato, ma su WSL le pagine non si caricheranno finché non cambi Electron.";
	const dir = mkdtempSync(join(tmpdir(), "tb-electron-"));
	try {
		const zip = join(dir, asset);
		const data = await download(`${RELEASE}/${asset}`);
		const expected = shaFor((await download(`${RELEASE}/SHASUMS256.txt`)).toString("utf8"), asset);
		const actual = createHash("sha256").update(data).digest("hex");
		if (!expected || expected !== actual) throw new Error(`SHA256 di ${asset} non corrisponde: non installo.`);
		writeFileSync(zip, data);
		const out = join(dir, "electron");
		await unzip(zip, out);
		if (!existsSync(join(out, "electron"))) throw new Error("L'archivio di Electron non contiene il binario.");
		renameSync(join(out, "electron"), join(out, "pixel"));
		// python's zipfile drops the executable bit.
		for (const name of ["pixel", "chrome_crashpad_handler", "chrome-sandbox"]) if (existsSync(join(out, name))) chmodSync(join(out, name), 0o755);
		const backup = join(root, "electron.orig");
		if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
		renameSync(join(root, "electron"), backup);
		try {
			await sh("cp", ["-a", out, join(root, "electron")]);
		} catch (error) {
			rmSync(join(root, "electron"), { recursive: true, force: true });
			renameSync(backup, join(root, "electron"));
			throw error;
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return `Electron ${WSL_ELECTRON_VERSION} installato (originale in ${join(root, "electron.orig")}). Apri terminal-browser in un pannello: terminal-browser open <url>.`;
}
