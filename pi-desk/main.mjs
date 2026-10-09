/**
 * Pi Desk (MVP): Pi in a window. Chat on the left (Pi in RPC mode as a child process: same extensions, memory, guards
 * and goals as in the terminal), a browser panel on the right that Pi drives with pi-browser over the DevTools
 * Protocol (PI_BROWSER_CDP points at this app's debug port; the chat page is skipped).
 *
 *   npm start [-- <project folder>]      PI_DESK_PI=<pi command>   PI_DESK_CDP_PORT=9339
 */
import { app, BrowserWindow, WebContentsView, clipboard, ipcMain, session as electronSession } from "electron";
import { PICKER_SCRIPT } from "./picker.mjs";
import { readForPanel } from "./files.mjs";
import { DESK_PROMPT } from "./prompt.mjs";
import { clipboardImage } from "./clipboard.mjs";
import { existsSync, mkdirSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiRpc } from "./rpc.mjs";
import { listSessions, markRunning, readTranscript, runningPi } from "./sessions.mjs";
import { linkRequest } from "./link.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const port = Number(process.env.PI_DESK_CDP_PORT ?? 9339);
// Only on loopback (Chromium's default for this switch): the page Pi drives is reachable from this machine only.
app.commandLine.appendSwitch("remote-debugging-port", String(port));
// WSLg: under Wayland the mouse pointer is not drawn in Chromium windows; X11 (XWayland) draws it. PI_DESK_OZONE overrides.
const wsl = process.platform === "linux" && (Boolean(process.env.WSL_DISTRO_NAME) || existsSync("/mnt/wslg") || /microsoft/i.test(readFileSync("/proc/version", "utf8")));
if (process.env.PI_DESK_OZONE) app.commandLine.appendSwitch("ozone-platform", process.env.PI_DESK_OZONE);
else if (wsl) app.commandLine.appendSwitch("ozone-platform", "x11");
// WSLg has no GPU for Chromium: accelerated compositing paints a white window. Software rendering draws it.
if (wsl && process.env.PI_DESK_GPU !== "1") app.disableHardwareAcceleration();

const UI_MARK = "pi-desk-ui";

/** The folder Pi works in: the first non-flag argument, else the current directory. */
let project = resolve(process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-")) ?? process.cwd());

/** pi-browser from this repo, unless the user's Pi already loads this repo as a package (it would register twice). */
function extraExtensions() {
	const browser = join(repo, "extensions", "browser.ts");
	if (!existsSync(browser)) return [];
	try {
		const settings = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8"));
		const packages = (settings.packages ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.source ?? ""));
		// Already loaded by an installed package (this repo, or another checkout of pi-claude): never twice.
		const local = packages.map((source) => resolve(source.replace(/^~/, homedir())));
		if (local.some((dir) => dir === repo || existsSync(join(dir, "extensions", "browser.ts")))) return [];
	} catch {
		// No settings: load it.
	}
	return ["-e", browser];
}

let win;
let view;
let lastRect;

/**
 * The browser view (a whole Chromium renderer) exists only once it is wanted: the panel opened, an address typed, or
 * Pi starting the browser tool. Until then nothing is spent on it.
 */
function ensureView() {
	if (view) return view;
	// plugins: Chromium's PDF viewer, for documents opened in the panel.
	view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true } });
	win.contentView.addChildView(view);
	view.setVisible(Boolean(lastRect && lastRect.width >= 10));
	if (lastRect && lastRect.width >= 10) view.setBounds(lastRect);
	view.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent("<title>pi-browser</title><body style='font:15px system-ui;background:#0c0c0c;color:#858ba0;display:grid;place-items:center;height:100vh;margin:0'><div>Il browser di Pi. Chiedi a Pi di aprire una pagina, oppure scrivi un indirizzo qui sopra.</div></body>"));
	const navigated = () => sendToUi("browser-url", { url: view.webContents.getURL(), title: view.webContents.getTitle(), back: view.webContents.navigationHistory.canGoBack(), forward: view.webContents.navigationHistory.canGoForward() });
	for (const name of ["did-navigate", "did-navigate-in-page", "page-title-updated"]) view.webContents.on(name, navigated);
	// Links that want a new window open in the panel: Pi drives one page.
	view.webContents.setWindowOpenHandler(({ url }) => {
		view.webContents.loadURL(url);
		return { action: "deny" };
	});
	return view;
}
let pi;

/** The native browser view sits exactly over the page's #browser-slot (the page reports it on every resize). */
function placeView(rect) {
	if (!rect) return;
	lastRect = rect;
	// The page closed the panel: no native view on top of the chat.
	if (rect.width < 10 || rect.height < 10) return void view?.setVisible(false);
	ensureView();
	view.setVisible(true);
	view.setBounds({ x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(0, rect.width), height: Math.max(0, rect.height) });
}

function sendToUi(channel, payload) {
	if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Pi for this window: in `cwd`, a new session or `session` (a session file) resumed. */
function startPi(options = {}) {
	if (options.cwd) project = options.cwd;
	pi = new PiRpc({
		command: process.env.PI_DESK_PI ?? "pi",
		args: ["--mode", "rpc", "--append-system-prompt", DESK_PROMPT, ...extraExtensions(), ...(options.session ? ["--session", options.session] : [])],
		cwd: project,
		env: { PI_BROWSER_CDP: `http://127.0.0.1:${port}`, PI_BROWSER_SKIP: UI_MARK, PI_BROWSER_WAIT: "4000" },
	});
	pi.on("event", (event) => {
		// Pi is about to drive the browser: make the page it will attach to.
		if (event.type === "tool_execution_start" && event.toolName === "browser") ensureView();
		sendToUi("pi-event", event);
	});
	pi.on("ui", (request) => sendToUi("pi-ui", request));
	pi.on("stderr", (text) => sendToUi("pi-stderr", text));
	const own = pi;
	pi.on("exit", (code) => own === pi && sendToUi("pi-exit", String(code)));
	pi.start();
	if (win) win.setTitle(`Pi Desk · ${project}`);
	sendToUi("project", project);
}

/** A session followed read-only: what is appended is sent as it is written (another Pi may be writing it). */
let watched;
function unwatch() {
	if (watched) unwatchFile(watched.path);
	watched = undefined;
}
function watch(path) {
	unwatch();
	const first = readTranscript(path);
	watched = { path, offset: first.offset };
	watchFile(path, { interval: 700 }, () => {
		if (!watched || watched.path !== path) return;
		const next = readTranscript(path, watched.offset);
		watched.offset = next.offset;
		if (next.items.length) sendToUi("session-append", { path, items: next.items });
	});
	return first.items;
}

app.whenReady().then(() => {
	win = new BrowserWindow({
		width: 1500,
		height: 950,
		title: `Pi Desk · ${project}`,
		backgroundColor: "#0d1117",
		webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	win.loadFile(join(here, "ui-dist", "index.html"), { query: { [UI_MARK]: "1", project } });

	// Downloads from the browser panel: straight into the project's .pi/downloads (no dialog; Pi lists them with
	// browser downloads), and the chat says so.
	electronSession.defaultSession.on("will-download", (_event, item) => {
		const dir = join(project, ".pi", "downloads");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, item.getFilename());
		item.setSavePath(path);
		item.once("done", (_done, state) => sendToUi("download", { path, state, bytes: item.getReceivedBytes() }));
	});

	win.webContents.on("did-finish-load", () => {
		sendToUi("home", homedir());
		sendToUi("project", project);
	});
	startPi();

	ipcMain.handle("prompt", (_event, text, images) => pi.prompt(text, images));
	ipcMain.handle("abort", () => pi.abort().catch(() => undefined));
	ipcMain.handle("ui-answer", (_event, id, fields) => pi.answer(id, fields));
	ipcMain.on("browser-rect", (_event, rect) => placeView(rect));
	ipcMain.handle("clipboard-image", () => clipboardImage(clipboard, wsl));
	ipcMain.handle("file", (_event, path) => readForPanel(path, project));
	// "Indica a Pi": the user picks an element in the panel; back come what it is and a picture of it.
	ipcMain.handle("pick", async () => {
		const contents = ensureView().webContents;
		contents.focus();
		const pick = await contents.executeJavaScript(PICKER_SCRIPT, true).catch(() => null);
		if (!pick) return null;
		const rect = { x: Math.round(pick.rect.x), y: Math.round(pick.rect.y), width: Math.max(1, Math.round(pick.rect.width)), height: Math.max(1, Math.round(pick.rect.height)) };
		const image = await contents.capturePage(rect).catch(() => undefined);
		return { ...pick, image: image && !image.isEmpty() ? image.toPNG().toString("base64") : undefined };
	});
	ipcMain.handle("restart", () => {
		pi.stop();
		startPi();
	});
	ipcMain.handle("sessions", () => markRunning(listSessions(), runningPi(), pi?.pid));
	ipcMain.handle("session-open", (_event, path) => watch(path));
	ipcMain.handle("session-close", () => unwatch());
	// A session running in a terminal Pi: written through that Pi (desk-link), never into its file.
	ipcMain.handle("session-link", async (_event, pid, path) => {
		const hello = await linkRequest(pid, { type: "hello" });
		if (hello.session && hello.session !== path) throw new Error("quel Pi ora lavora su un'altra sessione");
		return hello;
	});
	ipcMain.handle("session-send", (_event, pid, text) => linkRequest(pid, { type: "prompt", text }));
	ipcMain.handle("session-status", (_event, pid) => linkRequest(pid, { type: "status" }, { timeoutMs: 1500 }));
	ipcMain.handle("session-answer", (_event, pid, value) => linkRequest(pid, { type: "answer", value }));
	// Resume a closed session here: Pi restarts in that session's folder with it loaded.
	ipcMain.handle("session-resume", (_event, path, cwd) => {
		unwatch();
		pi.stop();
		startPi({ cwd, session: path });
		return readTranscript(path).items;
	});
	ipcMain.handle("session-new", () => {
		unwatch();
		pi.stop();
		startPi();
	});
	ipcMain.handle("browser", (_event, action, value) => {
		const contents = ensureView().webContents;
		if (action === "go") contents.loadURL(/^[a-z]+:/i.test(value) ? value : /^(localhost|127\.0\.0\.1)/.test(value) ? `http://${value}` : `https://${value}`);
		else if (action === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
		else if (action === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
		else if (action === "reload") contents.reload();
		else if (action === "devtools") contents.openDevTools({ mode: "detach" });
	});
});

app.on("window-all-closed", () => {
	pi?.stop();
	app.quit();
});
