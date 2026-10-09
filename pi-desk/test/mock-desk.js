// Stand-in for preload.cjs in tests: records calls, lets the test emit events.
window.calls = [];
const listeners = {};
window.desk = {
	prompt: (text) => (calls.push(["prompt", text]), Promise.resolve({ disposition: "started" })),
	abort: () => (calls.push(["abort"]), Promise.resolve()),
	answer: (id, fields) => calls.push(["answer", id, fields]),
	restart: () => Promise.resolve(),
	browser: (action, value) => calls.push(["browser", action, value]),
	browserRect: (rect) => (window.lastRect = rect),
	on: (channel, listener) => (listeners[channel] = listener),
	sessions: () => Promise.resolve([
		{ path: "/s/mine", cwd: "/p/claude", project: "claude", title: "questa", modified: Date.now(), running: { pid: 1, own: true } },
		{ path: "/s/live", cwd: "/p/shop", project: "shop", title: "sistema il carrello", modified: Date.now() - 60000, running: { pid: 42, own: false } },
		{ path: "/s/old", cwd: "/p/blog", project: "blog", title: "post di ottobre", modified: Date.now() - 86400000 * 3 },
		{ path: "/s/legacy", cwd: "/p/api", project: "api", title: "vecchio pi", modified: Date.now() - 120000, running: { pid: 77, own: false } },
	]),
	openSession: (path) => (calls.push(["open", path]), Promise.resolve([{ role: "user", text: "ciao" }, { role: "assistant", text: "**fatto**" }, { role: "tool", text: "read a.ts" }])),
	closeSession: () => calls.push(["close"]),
	resumeSession: (path, cwd) => (calls.push(["resume", path, cwd]), Promise.resolve([{ role: "user", text: "scrivi il post" }])),
	newSession: () => (calls.push(["new"]), Promise.resolve()),
	linkSession: (pid) => (pid === 42 ? Promise.resolve({ type: "hello", pid }) : Promise.reject(new Error("Error invoking remote method 'session-link': Error: questo Pi non ha desk-link: riavvialo per poterci scrivere"))),
	sendToSession: (pid, text) => (calls.push(["send", pid, text]), Promise.resolve({ type: "ok", queued: true })),
};
window.emit = (channel, payload) => listeners[channel]?.(payload);
