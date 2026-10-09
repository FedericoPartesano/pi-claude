// The only bridge between the chat page and the app: no Node in the page, a few named calls and events.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desk", {
	prompt: (text) => ipcRenderer.invoke("prompt", text),
	abort: () => ipcRenderer.invoke("abort"),
	answer: (id, fields) => ipcRenderer.invoke("ui-answer", id, fields),
	restart: () => ipcRenderer.invoke("restart"),
	browser: (action, value) => ipcRenderer.invoke("browser", action, value),
	on: (channel, listener) => {
		const allowed = ["pi-event", "pi-ui", "pi-stderr", "pi-exit", "browser-url", "layout", "project"];
		if (!allowed.includes(channel)) return;
		ipcRenderer.on(channel, (_event, payload) => listener(payload));
	},
});
