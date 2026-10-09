// The only bridge between the chat page and the app: no Node in the page, a few named calls and events.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desk", {
	prompt: (text, images) => ipcRenderer.invoke("prompt", text, images),
	abort: () => ipcRenderer.invoke("abort"),
	answer: (id, fields) => ipcRenderer.invoke("ui-answer", id, fields),
	restart: () => ipcRenderer.invoke("restart"),
	browser: (action, value) => ipcRenderer.invoke("browser", action, value),
	browserRect: (rect) => ipcRenderer.send("browser-rect", rect),
	sessions: () => ipcRenderer.invoke("sessions"),
	openSession: (path) => ipcRenderer.invoke("session-open", path),
	closeSession: () => ipcRenderer.invoke("session-close"),
	resumeSession: (path, cwd) => ipcRenderer.invoke("session-resume", path, cwd),
	newSession: () => ipcRenderer.invoke("session-new"),
	linkSession: (pid, path) => ipcRenderer.invoke("session-link", pid, path),
	sendToSession: (pid, text) => ipcRenderer.invoke("session-send", pid, text),
	on: (channel, listener) => {
		const allowed = ["pi-event", "pi-ui", "pi-stderr", "pi-exit", "browser-url", "project", "session-append"];
		if (!allowed.includes(channel)) return;
		ipcRenderer.on(channel, (_event, payload) => listener(payload));
	},
});
