/**
 * Pi Desk (MVP): Pi in a window. Chat on the left (Pi in RPC mode as a child process: same extensions, memory, guards
 * and goals as in the terminal), a browser panel on the right that Pi drives with pi-browser over the DevTools
 * Protocol (PI_BROWSER_CDP points at this app's debug port; the chat page is skipped).
 *
 *   npm start [-- <project folder>]      PI_DESK_PI=<pi command>   PI_DESK_CDP_PORT=9339
 */
import { app, BrowserWindow, WebContentsView, ipcMain } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiRpc } from "./rpc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const port = Number(process.env.PI_DESK_CDP_PORT ?? 9339);
// Only on loopback (Chromium's default for this switch): the page Pi drives is reachable from this machine only.
app.commandLine.appendSwitch("remote-debugging-port", String(port));

const UI_MARK = "pi-desk-ui";
const HEADER = 44;
const CHAT_SHARE = 0.42;

/** The folder Pi works in: the first non-flag argument, else the current directory. */
const project = resolve(process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-")) ?? process.cwd());

/** pi-browser from this repo, unless the user's Pi already loads this repo as a package (it would register twice). */
function extraExtensions() {
	const browser = join(repo, "extensions", "browser.ts");
	if (!existsSync(browser)) return [];
	try {
		const settings = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8"));
		const packages = (settings.packages ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.source ?? ""));
		if (packages.some((source) => resolve(source.replace(/^~/, homedir())) === repo)) return [];
	} catch {
		// No settings: load it.
	}
	return ["-e", browser];
}

let win;
let view;
let pi;

function layout() {
	if (!win || !view) return;
	const [width, height] = win.getContentSize();
	const left = Math.round(width * CHAT_SHARE);
	view.setBounds({ x: left, y: HEADER, width: width - left, height: height - HEADER });
	win.webContents.send("layout", { left, header: HEADER });
}

function sendToUi(channel, payload) {
	if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startPi() {
	pi = new PiRpc({
		command: process.env.PI_DESK_PI ?? "pi",
		args: ["--mode", "rpc", ...extraExtensions()],
		cwd: project,
		env: { PI_BROWSER_CDP: `http://127.0.0.1:${port}`, PI_BROWSER_SKIP: UI_MARK },
	});
	pi.on("event", (event) => sendToUi("pi-event", event));
	pi.on("ui", (request) => sendToUi("pi-ui", request));
	pi.on("stderr", (text) => sendToUi("pi-stderr", text));
	pi.on("exit", (code) => sendToUi("pi-exit", String(code)));
	pi.start();
}

app.whenReady().then(() => {
	win = new BrowserWindow({
		width: 1500,
		height: 950,
		title: `Pi Desk · ${project}`,
		backgroundColor: "#0d1117",
		webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	win.loadFile(join(here, "ui", "index.html"), { query: { [UI_MARK]: "1", project } });

	view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
	win.contentView.addChildView(view);
	view.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent("<title>pi-browser</title><body style='font:15px system-ui;background:#0d1117;color:#8b949e;display:grid;place-items:center;height:100vh;margin:0'><div>Il browser di Pi. Chiedi a Pi di aprire una pagina, oppure scrivi un indirizzo qui sopra.</div></body>"));
	const navigated = () => sendToUi("browser-url", { url: view.webContents.getURL(), title: view.webContents.getTitle(), back: view.webContents.navigationHistory.canGoBack(), forward: view.webContents.navigationHistory.canGoForward() });
	for (const name of ["did-navigate", "did-navigate-in-page", "page-title-updated"]) view.webContents.on(name, navigated);
	// Links that want a new window open in the panel: Pi drives one page.
	view.webContents.setWindowOpenHandler(({ url }) => {
		view.webContents.loadURL(url);
		return { action: "deny" };
	});

	win.on("resize", layout);
	win.webContents.on("did-finish-load", () => {
		layout();
		navigated();
		sendToUi("project", project);
	});
	startPi();

	ipcMain.handle("prompt", (_event, text) => pi.prompt(text));
	ipcMain.handle("abort", () => pi.abort().catch(() => undefined));
	ipcMain.handle("ui-answer", (_event, id, fields) => pi.answer(id, fields));
	ipcMain.handle("restart", () => {
		pi.stop();
		startPi();
	});
	ipcMain.handle("browser", (_event, action, value) => {
		const contents = view.webContents;
		if (action === "go") contents.loadURL(/^[a-z]+:/i.test(value) ? value : /^(localhost|127\.0\.0\.1)/.test(value) ? `http://${value}` : `https://${value}`);
		else if (action === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
		else if (action === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
		else if (action === "reload") contents.reload();
	});
});

app.on("window-all-closed", () => {
	pi?.stop();
	app.quit();
});
