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
	file: (path) => (calls.push(["file", path]), Promise.resolve(path.endsWith(".pdf") ? { kind: "pdf", name: "r.pdf", path, size: 9, url: "file:///p/r.pdf" } : { kind: "csv", name: "vendite.csv", path: "/p/" + path, size: 120, rows: [["mese", "k€"], ["feb", "5"], ["gen", "30"], ["mar", "12"]] })),
	pick: () => Promise.resolve(null),
	clipboardImage: () => Promise.resolve(undefined),
	linkSession: (pid) => (pid === 42 ? Promise.resolve({ type: "hello", pid }) : Promise.reject(new Error("Error invoking remote method 'session-link': Error: questo Pi non ha desk-link: riavvialo per poterci scrivere"))),
	sendToSession: (pid, text) => (calls.push(["send", pid, text]), Promise.resolve({ type: "ok", queued: true })),
	sessionStatus: () => Promise.resolve({ status: window.remoteStatus ?? null, busy: true }),
	info: () => Promise.resolve(window.mockInfo ?? { project: "/p/claude", branch: "main", changes: 2, usage: { fiveHour: 34, sevenDay: 18, overage: false, updatedAt: "2026-10-09T14:01:50Z" }, model: "claude-sonnet-4-5", thinking: "medium", context: 41, user: "fede" }),
	fork: (text, occurrence) => (calls.push(["fork", text, occurrence]), Promise.resolve({ text: "rifai", cancelled: false, items: [{ role: "user", text: "prima" }] })),
	openExternal: (target) => (calls.push(["external", target]), Promise.resolve()),
	answerSession: (pid, value) => (calls.push(["remote-answer", pid, value]), (window.remoteStatus = { mode: "working", activity: "ripreso" }), Promise.resolve({ type: "ok" })),
};
window.emit = (channel, payload) => listeners[channel]?.(payload);
