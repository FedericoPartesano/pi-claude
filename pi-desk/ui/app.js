// Pi Desk chat: Pi's RPC events in, prompts and dialog answers out (through window.desk, see preload.cjs).
const $ = (id) => document.getElementById(id);
const log = $("log");
const input = $("input");
let current; // the assistant message being streamed
let currentText = "";
const tools = new Map(); // toolCallId → its line
const statuses = new Map(); // extension status lines (setStatus)
let busy = false;

const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** Small Markdown: fenced code, inline code, bold, line breaks. Everything else stays text. */
function markdown(text) {
	const parts = text.split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
	let html = "";
	for (let i = 0; i < parts.length; i += 3) {
		html += escapeHtml(parts[i])
			.replace(/`([^`\n]+)`/g, "<code>$1</code>")
			.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
			.replace(/\n/g, "<br>");
		if (parts[i + 2] !== undefined) html += `<pre><code>${escapeHtml(parts[i + 2])}</code></pre>`;
	}
	return html;
}

function add(className, html) {
	const element = document.createElement("div");
	element.className = className;
	element.innerHTML = html;
	const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
	log.appendChild(element);
	if (atBottom) log.scrollTop = log.scrollHeight;
	return element;
}

function setBusy(value, label) {
	busy = value;
	$("status").textContent = label ?? (value ? "sta lavorando…" : "pronto");
	$("status").classList.toggle("busy", value);
	$("stop").hidden = !value;
}

function toolLabel(event) {
	const args = event.args ?? {};
	const detail = args.action ? `${args.action} ${args.url ?? args.ref ?? ""} ${args.do ?? ""}` : args.command ?? args.path ?? args.query ?? "";
	return `${event.toolName} ${String(detail).trim().slice(0, 120)}`;
}

window.desk.on("pi-event", (event) => {
	switch (event.type) {
		case "agent_start":
			setBusy(true);
			break;
		case "message_start":
			if (event.message?.role === "assistant") {
				current = undefined;
				currentText = "";
			}
			break;
		case "message_update": {
			const update = event.assistantMessageEvent;
			if (update?.type !== "text_delta") break;
			currentText += update.delta;
			current ??= add("msg assistant", "");
			current.innerHTML = markdown(currentText);
			log.scrollTop = log.scrollHeight;
			break;
		}
		case "message_end":
			if (event.message?.errorMessage) add("msg assistant error", escapeHtml(event.message.errorMessage));
			current = undefined;
			break;
		case "tool_execution_start":
			tools.set(event.toolCallId, add("tool run", escapeHtml(toolLabel(event))));
			break;
		case "tool_execution_end": {
			const line = tools.get(event.toolCallId);
			if (line) line.className = `tool ${event.isError ? "err" : "ok"}`;
			break;
		}
		case "agent_settled":
			setBusy(false);
			break;
	}
});

/** Extension dialogs (confirm, select, input) as a modal; notify and setStatus as lines. */
window.desk.on("pi-ui", (request) => {
	if (request.method === "notify") return void add("note", escapeHtml(request.message ?? ""));
	if (request.method === "setStatus") {
		if (request.statusText) statuses.set(request.statusKey, request.statusText);
		else statuses.delete(request.statusKey);
		$("chips").textContent = [...statuses.values()].join(" · ");
		return;
	}
	if (!["confirm", "select", "input"].includes(request.method)) return;
	$("dialog-title").textContent = request.title ?? "Pi";
	$("dialog-message").textContent = request.message ?? "";
	const actions = $("dialog-actions");
	actions.replaceChildren();
	const close = (fields) => {
		$("dialog").hidden = true;
		window.desk.answer(request.id, fields);
		input.focus();
	};
	const button = (label, fields) => {
		const element = document.createElement("button");
		element.textContent = label;
		element.onclick = () => close(fields);
		actions.appendChild(element);
		return element;
	};
	if (request.method === "confirm") {
		button("No", { confirmed: false });
		button("Sì", { confirmed: true }).focus();
	} else if (request.method === "select") {
		for (const option of request.options ?? []) button(option, { value: option });
		button("Annulla", { cancelled: true });
	} else {
		const field = document.createElement("input");
		field.value = request.prefill ?? "";
		actions.appendChild(field);
		field.onkeydown = (event) => event.key === "Enter" && close({ value: field.value });
		button("Annulla", { cancelled: true });
		button("OK", {}).onclick = () => close({ value: field.value });
		setTimeout(() => field.focus());
	}
	$("dialog").hidden = false;
});

window.desk.on("pi-stderr", (text) => {
	if (/error|errore/i.test(text)) add("note", escapeHtml(text.trim().slice(0, 300)));
});
window.desk.on("pi-exit", (code) => {
	setBusy(false, "Pi si è fermato");
	add("note", `Pi si è fermato (${escapeHtml(code)}). <button id="restart">Riavvia</button>`);
	$("restart").onclick = () => window.desk.restart().then(() => setBusy(false));
});
window.desk.on("project", (project) => ($("project").textContent = project));
window.desk.on("layout", ({ left }) => document.documentElement.style.setProperty("--left", `${left}px`));
window.desk.on("browser-url", ({ url, title, back, forward }) => {
	if (document.activeElement !== $("url")) $("url").value = url.startsWith("data:") ? "" : url;
	$("title").textContent = title ?? "";
	$("back").disabled = !back;
	$("forward").disabled = !forward;
});

async function send() {
	const text = input.value.trim();
	if (!text) return;
	input.value = "";
	add("msg user", escapeHtml(text));
	try {
		const result = await window.desk.prompt(text);
		if (result?.disposition === "queued") add("note", "in coda: Pi lo legge appena finisce");
	} catch (error) {
		add("msg assistant error", escapeHtml(error.message));
	}
}

$("composer").onsubmit = (event) => {
	event.preventDefault();
	send();
};
input.onkeydown = (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		send();
	}
};
document.addEventListener("keydown", (event) => event.key === "Escape" && busy && window.desk.abort());
$("stop").onclick = () => window.desk.abort();
$("url").onkeydown = (event) => event.key === "Enter" && window.desk.browser("go", $("url").value.trim());
$("back").onclick = () => window.desk.browser("back");
$("forward").onclick = () => window.desk.browser("forward");
$("reload").onclick = () => window.desk.browser("reload");
setBusy(false, "pronto");
input.focus();

// ---- Sessions: every Pi session on this PC; running ones followed read-only, closed ones resumable here ----------

const sessionsPanel = $("sessions");
const viewer = $("viewer");
let viewing; // the session shown read-only
let sessionsTimer;

function renderItem(container, item) {
	const element = document.createElement("div");
	if (item.role === "tool") {
		element.className = "tool ok";
		element.textContent = item.text;
	} else {
		element.className = `msg ${item.role === "user" ? "user" : "assistant"}${item.role === "error" ? " error" : ""}`;
		element.innerHTML = item.role === "user" ? escapeHtml(item.text) : markdown(item.text);
	}
	container.appendChild(element);
}

const ago = (ms) => {
	const minutes = Math.round((Date.now() - ms) / 60000);
	if (minutes < 1) return "adesso";
	if (minutes < 60) return `${minutes} min fa`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours} h fa` : `${Math.round(hours / 24)} g fa`;
};

async function refreshSessions() {
	const all = await window.desk.sessions();
	const filter = $("session-filter").value.trim().toLowerCase();
	const shown = all.filter((session) => !filter || `${session.title} ${session.project} ${session.cwd}`.toLowerCase().includes(filter));
	// Running first, then by project in order of last activity.
	const running = shown.filter((session) => session.running);
	const groups = new Map();
	for (const session of shown.filter((item) => !item.running)) groups.set(session.project, [...(groups.get(session.project) ?? []), session]);
	const list = $("session-list");
	list.replaceChildren();
	const section = (label, items) => {
		if (!items.length) return;
		const heading = document.createElement("div");
		heading.className = "group";
		heading.textContent = label;
		list.appendChild(heading);
		for (const session of items) {
			const button = document.createElement("button");
			button.className = "session";
			const badge = session.running ? (session.running.own ? '<span class="badge own">questa finestra</span>' : `<span class="badge live">● in corso · pid ${session.running.pid}</span>`) : "";
			button.innerHTML = `<span class="title">${escapeHtml(session.title)}${badge}</span><span class="meta">${escapeHtml(session.project)} · ${ago(session.modified)}</span>`;
			button.onclick = () => openSession(session);
			list.appendChild(button);
		}
	};
	section("In corso", running);
	for (const [project, items] of groups) section(project, items);
	if (!list.children.length) list.textContent = "Nessuna sessione.";
}

function showPanel(open) {
	sessionsPanel.hidden = !open;
	if (open) {
		refreshSessions();
		sessionsTimer = setInterval(refreshSessions, 4000);
		$("session-filter").focus();
	} else clearInterval(sessionsTimer);
	log.hidden = open || Boolean(viewing);
	viewer.hidden = open || !viewing;
}

function showChat() {
	viewing = undefined;
	window.desk.closeSession();
	viewer.hidden = true;
	$("viewer-bar").hidden = true;
	$("composer").classList.remove("readonly");
	log.hidden = false;
	input.focus();
}

async function openSession(session) {
	showPanel(false);
	if (session.running?.own) return showChat();
	viewing = session;
	const items = await window.desk.openSession(session.path);
	viewer.replaceChildren();
	for (const item of items) renderItem(viewer, item);
	viewer.scrollTop = viewer.scrollHeight;
	$("viewer-label").textContent = session.running ? `● In corso in un altro Pi (pid ${session.running.pid}) · sola lettura, si aggiorna da sola` : `Sessione chiusa · ${session.project} · sola lettura`;
	$("viewer-resume").hidden = Boolean(session.running);
	$("viewer-bar").hidden = false;
	viewer.hidden = false;
	log.hidden = true;
	$("composer").classList.add("readonly");
}

window.desk.on("session-append", ({ path, items }) => {
	if (viewing?.path !== path) return;
	const atBottom = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 60;
	for (const item of items) renderItem(viewer, item);
	if (atBottom) viewer.scrollTop = viewer.scrollHeight;
});

$("viewer-resume").onclick = async () => {
	const session = viewing;
	const items = await window.desk.resumeSession(session.path, session.cwd);
	log.replaceChildren();
	for (const item of items) renderItem(log, item);
	add("note", `Sessione ripresa: Pi continua da qui, in ${escapeHtml(session.cwd)}`);
	showChat();
	log.scrollTop = log.scrollHeight;
};
$("viewer-back").onclick = showChat;
$("toggle-sessions").onclick = () => showPanel(sessionsPanel.hidden);
$("session-filter").oninput = refreshSessions;
$("new-session").onclick = async () => {
	await window.desk.newSession();
	log.replaceChildren();
	add("note", "Nuova sessione");
	showPanel(false);
	showChat();
};
