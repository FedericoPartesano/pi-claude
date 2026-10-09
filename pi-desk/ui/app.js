// Pi Desk chat: Pi's RPC events in, prompts and dialog answers out (through window.desk, see preload.cjs).
// Rendering (markdown, charts, suggestions) lives in render.js (window.PiRender).
const $ = (id) => document.getElementById(id);
const { escapeHtml, answer } = window.PiRender;
const app = $("app");
const scroll = $("scroll");
const log = $("log");
const viewer = $("viewer");
const input = $("input");

const store = {
	get: (key) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set: (key, value) => {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Not persisted: fine.
		}
	},
};
/** Electron prefixes errors from the main process: keep the sentence the user can act on. */
const clean = (message) => String(message ?? "").replace(/^Error invoking remote method '[^']+': /, "").replace(/^Error: /, "");
const ago = (ms) => {
	const minutes = Math.round((Date.now() - ms) / 60000);
	if (minutes < 1) return "adesso";
	if (minutes < 60) return `${minutes} min fa`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours} h fa` : `${Math.round(hours / 24)} g fa`;
};

// ---- Scrolling: follow the end only while the user is there -----------------------------------------------------
const nearEnd = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
function keepEnd(wasNear) {
	if (wasNear) scroll.scrollTop = scroll.scrollHeight;
}

// ---- Building blocks --------------------------------------------------------------------------------------------
function el(tag, className, html) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (html !== undefined) element.innerHTML = html;
	return element;
}

function showEmpty() {
	$("empty").hidden = log.children.length > 0 || !viewer.hidden;
}

function userBubble(container, text) {
	container.appendChild(el("div", "turn-user")).textContent = text;
}

function piTurn(container) {
	const turn = el("div", "turn-pi");
	turn.appendChild(el("div", "who", '<span class="logo">π</span><b>Pi</b>'));
	container.appendChild(turn);
	return turn;
}

const TOOL_ICONS = { bash: "›_", read: "◱", edit: "✎", write: "＋", grep: "⌕", find: "⌕", ls: "≡", browser: "◎", web_search: "⌕", fetch_content: "⇣", ricorda: "◇", goal_done: "✓", team: "⚑", subagent: "⚑", load_tools: "⊕", todo: "☐" };

function toolBrief(name, args = {}) {
	if (name === "browser") return [args.action, args.url ?? args.ref, args.do, args.text].filter(Boolean).join(" ");
	return String(args.command ?? args.path ?? args.file_path ?? args.url ?? args.query ?? args.pattern ?? args.id ?? args.goal ?? "").replace(/\s+/g, " ");
}

function stepRow(steps, name, args, state = "run") {
	const row = el("div", `step ${state}`);
	const head = el("button", "head");
	head.type = "button";
	head.innerHTML = `<span class="ico">${escapeHtml(TOOL_ICONS[name] ?? "•")}</span><span class="name">${escapeHtml(name)}</span><span class="arg">${escapeHtml(toolBrief(name, args).slice(0, 200))}</span><span class="state">${state === "run" ? "in corso" : ""}</span>`;
	head.onclick = () => row.querySelector(".out").textContent && row.classList.toggle("open");
	row.append(head, el("pre", "out"));
	steps.appendChild(row);
	return row;
}

function suggestionsBar(container, suggestions) {
	if (!suggestions.length) return;
	const bar = el("div", "suggestions");
	for (const text of suggestions) {
		const button = el("button");
		button.type = "button";
		button.textContent = text;
		button.onclick = () => {
			input.value = text;
			grow();
			input.focus();
		};
		bar.appendChild(button);
	}
	container.appendChild(bar);
}

// ---- Live turn (from RPC events) ----------------------------------------------------------------------------------
const live = { turn: undefined, text: undefined, textEl: undefined, think: undefined, thinkText: "", thinkStart: 0, steps: undefined, tools: new Map(), lastText: "", frame: 0 };
let busy = false;

function setBusy(value, label) {
	busy = value;
	const status = $("status");
	status.textContent = label ?? (value ? "sta lavorando…" : "pronto");
	status.classList.toggle("busy", value);
	$("stop").hidden = !value;
}

function turn() {
	if (!live.turn) {
		live.turn = piTurn(log);
		showEmpty();
	}
	return live.turn;
}

function closeThinking() {
	if (!live.think) return;
	const seconds = Math.max(1, Math.round((Date.now() - live.thinkStart) / 1000));
	live.think.classList.remove("live");
	live.think.open = false;
	live.think.querySelector("summary").textContent = `Ragionamento · ${seconds} s`;
	live.think = undefined;
}

function paintText() {
	live.frame = 0;
	if (!live.textEl) return;
	const near = nearEnd();
	live.textEl.innerHTML = answer(live.text).html;
	keepEnd(near);
}

window.desk.on("pi-event", (event) => {
	const near = nearEnd();
	switch (event.type) {
		case "agent_start":
			setBusy(true);
			break;
		case "message_start":
			if (event.message?.role === "assistant") {
				live.textEl = undefined;
				live.text = "";
			}
			break;
		case "message_update": {
			const update = event.assistantMessageEvent;
			if (update?.type === "thinking_delta") {
				if (!live.think) {
					live.think = el("details", "thinking live", "<summary>Ragionamento…</summary>");
					live.think.open = true;
					live.think.appendChild(el("div", "body"));
					live.thinkText = "";
					live.thinkStart = Date.now();
					turn().appendChild(live.think);
					live.steps = undefined;
				}
				live.thinkText += update.delta;
				live.think.querySelector(".body").textContent = live.thinkText;
			} else if (update?.type === "text_delta") {
				closeThinking();
				if (!live.textEl) {
					live.textEl = el("div", "md");
					turn().appendChild(live.textEl);
					live.steps = undefined;
					live.text = "";
				}
				live.text += update.delta;
				live.lastText = live.text;
				if (!live.frame) live.frame = requestAnimationFrame(paintText);
			}
			break;
		}
		case "message_end":
			closeThinking();
			if (live.frame) cancelAnimationFrame(live.frame);
			paintText();
			if (event.message?.errorMessage) turn().appendChild(el("div", "error-card")).textContent = clean(event.message.errorMessage);
			live.textEl = undefined;
			break;
		case "tool_execution_start": {
			closeThinking();
			live.textEl = undefined;
			if (!live.steps) {
				live.steps = el("div", "steps");
				turn().appendChild(live.steps);
			}
			live.tools.set(event.toolCallId, { row: stepRow(live.steps, event.toolName, event.args), start: Date.now() });
			setBusy(true, `${event.toolName} ${toolBrief(event.toolName, event.args)}`.slice(0, 60));
			break;
		}
		case "tool_execution_end": {
			const tool = live.tools.get(event.toolCallId);
			if (!tool) break;
			const seconds = (Date.now() - tool.start) / 1000;
			tool.row.className = `step ${event.isError ? "err" : "ok"}`;
			tool.row.querySelector(".state").textContent = seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`;
			const output = (event.result?.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
			tool.row.querySelector(".out").textContent = output.length > 8000 ? `${output.slice(0, 8000)}\n… (${output.length - 8000} caratteri in più)` : output;
			live.tools.delete(event.toolCallId);
			setBusy(true);
			break;
		}
		case "agent_settled":
			closeThinking();
			if (live.turn) suggestionsBar(live.turn, answer(live.lastText).suggestions);
			live.turn = undefined;
			live.steps = undefined;
			live.lastText = "";
			setBusy(false);
			break;
	}
	keepEnd(near);
});

// ---- Dialogs, statuses, errors -------------------------------------------------------------------------------------
const statuses = new Map();
window.desk.on("pi-ui", (request) => {
	if (request.method === "notify") {
		log.appendChild(el("div", "note")).textContent = request.message ?? "";
		return;
	}
	if (request.method === "setStatus") {
		if (request.statusText) statuses.set(request.statusKey, request.statusText);
		else statuses.delete(request.statusKey);
		$("chips").textContent = [...statuses.values()].join("   ·   ");
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
	const button = (label, fields, primary) => {
		const element = el("button", primary ? "primary" : "");
		element.type = "button";
		element.textContent = label;
		element.onclick = () => close(fields);
		actions.appendChild(element);
		return element;
	};
	if (request.method === "confirm") {
		button("No", { confirmed: false });
		button("Sì", { confirmed: true }, true).focus();
	} else if (request.method === "select") {
		for (const option of request.options ?? []) button(option, { value: option });
		button("Annulla", { cancelled: true });
	} else {
		const field = el("input");
		field.value = request.prefill ?? "";
		actions.appendChild(field);
		field.onkeydown = (event) => event.key === "Enter" && close({ value: field.value });
		button("Annulla", { cancelled: true });
		button("OK", {}, true).onclick = () => close({ value: field.value });
		setTimeout(() => field.focus());
	}
	$("dialog").hidden = false;
});

window.desk.on("pi-stderr", (text) => {
	if (/\b(error|errore)\b/i.test(text) && !/MODULE_TYPELESS|ExperimentalWarning/.test(text)) log.appendChild(el("div", "note")).textContent = text.trim().slice(0, 240);
});
window.desk.on("pi-exit", (code) => {
	setBusy(false, "Pi fermo");
	$("status").classList.add("off");
	const card = log.appendChild(el("div", "error-card", `Pi si è fermato (${escapeHtml(code)}). <button type="button">Riavvia</button>`));
	card.querySelector("button").onclick = () => window.desk.restart().then(() => {
		$("status").classList.remove("off");
		setBusy(false);
		card.remove();
	});
});
window.desk.on("project", (project) => {
	$("project-name").textContent = project.split(/[\\/]/).filter(Boolean).pop() ?? project;
	$("project-path").textContent = project;
	$("project-path").title = project;
});

// ---- Sending ---------------------------------------------------------------------------------------------------------
function grow() {
	input.style.height = "auto";
	input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;
	$("send").disabled = !input.value.trim();
}

let viewing; // a session from the sidebar, shown in the viewer

async function send() {
	const text = input.value.trim();
	if (!text) return;
	input.value = "";
	grow();
	// A session running in a terminal Pi: the message goes to that Pi (it shows up there, and here when written).
	if (viewing?.writable) {
		try {
			const reply = await window.desk.sendToSession(viewing.running.pid, text);
			viewer.appendChild(el("div", "note")).textContent = reply.queued ? "Inviato: in coda, Pi lo legge appena finisce il passo in corso" : "Inviato al Pi nel terminale";
		} catch (error) {
			viewer.appendChild(el("div", "error-card")).textContent = `Non inviato: ${clean(error.message)}`;
		}
		scroll.scrollTop = scroll.scrollHeight;
		return;
	}
	userBubble(log, text);
	showEmpty();
	scroll.scrollTop = scroll.scrollHeight;
	try {
		const result = await window.desk.prompt(text);
		if (result?.disposition === "queued") log.appendChild(el("div", "note")).textContent = "In coda: Pi lo legge appena finisce";
	} catch (error) {
		log.appendChild(el("div", "error-card")).textContent = clean(error.message);
	}
}

$("composer").onsubmit = (event) => {
	event.preventDefault();
	send();
};
input.oninput = grow;
input.onkeydown = (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		send();
	}
};
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !$("dialog").hidden) return;
	if (event.key === "Escape" && busy) window.desk.abort();
});
$("stop").onclick = () => window.desk.abort();
for (const button of document.querySelectorAll(".examples button")) {
	button.onclick = () => {
		input.value = button.textContent;
		grow();
		input.focus();
	};
}

// Links open in the browser panel; code blocks copy.
document.addEventListener("click", (event) => {
	const link = event.target.closest?.(".md a[href]");
	if (link) {
		event.preventDefault();
		window.desk.browser("go", link.getAttribute("href"));
		return;
	}
	const copy = event.target.closest?.(".code .copy");
	if (copy) {
		navigator.clipboard?.writeText(copy.closest(".code").querySelector("code").textContent).then(() => {
			copy.textContent = "Copiato";
			setTimeout(() => (copy.textContent = "Copia"), 1400);
		});
	}
});

// ---- Browser panel: address bar, and the native view placed over #browser-slot -------------------------------------
window.desk.on("browser-url", ({ url, title, back, forward }) => {
	const blank = !url || url.startsWith("data:");
	if (document.activeElement !== $("url")) $("url").value = blank ? "" : url;
	$("url").title = title ?? "";
	$("lock").textContent = blank ? "" : url.startsWith("https:") ? "🔒" : url.startsWith("http:") ? "⚠" : "";
	$("back").disabled = !back;
	$("forward").disabled = !forward;
});
$("url").onkeydown = (event) => {
	if (event.key !== "Enter") return;
	const value = $("url").value.trim();
	if (!value) return;
	window.desk.browser("go", /\s/.test(value) || !/[.:]/.test(value) ? `https://duckduckgo.com/?q=${encodeURIComponent(value)}` : value);
};
$("back").onclick = () => window.desk.browser("back");
$("forward").onclick = () => window.desk.browser("forward");
$("reload").onclick = () => window.desk.browser("reload");

const slot = $("browser-slot");
const sendRect = () => {
	const rect = slot.getBoundingClientRect();
	window.desk.browserRect?.({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) });
};
new ResizeObserver(sendRect).observe(slot);
window.addEventListener("resize", sendRect);

// Splitter: chat width as a share of the window, remembered.
const savedChat = Number(store.get("pi-desk.chat"));
if (savedChat >= 25 && savedChat <= 75) app.style.setProperty("--chat", `${savedChat}%`);
$("splitter").onmousedown = (down) => {
	down.preventDefault();
	const splitter = $("splitter");
	splitter.classList.add("dragging");
	const sidebar = app.classList.contains("sidebar-open") ? 272 : 0;
	const move = (event) => {
		const share = Math.min(75, Math.max(25, ((event.clientX - sidebar) / (window.innerWidth - sidebar)) * 100));
		app.style.setProperty("--chat", `${share.toFixed(1)}%`);
		store.set("pi-desk.chat", share.toFixed(1));
	};
	const up = () => {
		splitter.classList.remove("dragging");
		window.removeEventListener("mousemove", move);
		window.removeEventListener("mouseup", up);
		sendRect();
	};
	window.addEventListener("mousemove", move);
	window.addEventListener("mouseup", up);
};

// ---- Sessions: every Pi session on this PC; running ones followed live (and writable through desk-link) -----------
let sessionsTimer;

function renderItems(container, items) {
	let current;
	let steps;
	for (const item of items) {
		if (item.role === "user") {
			userBubble(container, item.text);
			current = undefined;
			steps = undefined;
			continue;
		}
		current ??= piTurn(container);
		if (item.role === "tool") {
			steps ??= current.appendChild(el("div", "steps"));
			const [name, ...rest] = item.text.split(" ");
			const row = stepRow(steps, name, {}, "ok");
			row.querySelector(".arg").textContent = rest.join(" ");
		} else if (item.role === "error") {
			current.appendChild(el("div", "error-card")).textContent = clean(item.text);
			steps = undefined;
		} else {
			const { html, suggestions } = answer(item.text);
			current.appendChild(el("div", "md", html));
			suggestionsBar(current, suggestions);
			steps = undefined;
		}
	}
}

function bucket(session) {
	if (session.running) return "In corso";
	const day = 86400000;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	if (session.modified >= today.getTime()) return "Oggi";
	if (session.modified >= today.getTime() - day) return "Ieri";
	if (session.modified >= today.getTime() - 7 * day) return "Ultimi 7 giorni";
	return "Più vecchie";
}

async function refreshSessions() {
	let all = [];
	try {
		all = await window.desk.sessions();
	} catch (error) {
		$("session-list").textContent = clean(error.message);
		return;
	}
	const filter = $("session-filter").value.trim().toLowerCase();
	const shown = all.filter((session) => !filter || `${session.title} ${session.project} ${session.cwd}`.toLowerCase().includes(filter));
	const groups = new Map(["In corso", "Oggi", "Ieri", "Ultimi 7 giorni", "Più vecchie"].map((name) => [name, []]));
	for (const session of shown) groups.get(bucket(session)).push(session);
	const list = $("session-list");
	list.replaceChildren();
	for (const [name, items] of groups) {
		if (!items.length) continue;
		list.appendChild(el("div", "group")).textContent = name;
		for (const session of items) {
			const button = el("button", `session${viewing?.path === session.path ? " active" : ""}`);
			button.type = "button";
			const state = session.running ? (session.running.own ? '<span class="own">● questa finestra</span>' : `<span class="live">● in corso</span>`) : "";
			button.innerHTML = `<span class="title">${escapeHtml(session.title)}</span><span class="meta">${state}<span>${escapeHtml(session.project)}</span>·<span>${ago(session.modified)}</span></span>`;
			button.title = session.cwd;
			button.onclick = () => openSession(session);
			list.appendChild(button);
		}
	}
	if (!list.children.length) list.appendChild(el("div", "note")).textContent = "Nessuna sessione";
}

function showSidebar(open) {
	app.classList.toggle("sidebar-open", open);
	store.set("pi-desk.sidebar", open ? "1" : "0");
	clearInterval(sessionsTimer);
	if (open) {
		refreshSessions();
		sessionsTimer = setInterval(refreshSessions, 4000);
	}
	setTimeout(sendRect, 0);
}

function showChat() {
	viewing = undefined;
	window.desk.closeSession();
	viewer.hidden = true;
	$("viewer-bar").hidden = true;
	$("composer").classList.remove("readonly");
	input.placeholder = "Chiedi a Pi…";
	log.hidden = false;
	showEmpty();
	if (app.classList.contains("sidebar-open")) refreshSessions();
	input.focus();
}

async function openSession(session) {
	if (session.running?.own) return showChat();
	viewing = { ...session, writable: false };
	const items = await window.desk.openSession(session.path);
	viewer.replaceChildren();
	renderItems(viewer, items);
	log.hidden = true;
	viewer.hidden = false;
	showEmpty();
	$("viewer-bar").hidden = false;
	$("viewer-bar").classList.toggle("live", Boolean(session.running));
	$("viewer-resume").hidden = Boolean(session.running);
	scroll.scrollTop = scroll.scrollHeight;
	refreshSessions();
	if (!session.running) {
		$("viewer-label").textContent = `Sessione chiusa · ${session.project} · sola lettura`;
		$("composer").classList.add("readonly");
		return;
	}
	$("viewer-label").textContent = `In corso nel terminale · ${session.project} · collegamento…`;
	$("composer").classList.add("readonly");
	try {
		await window.desk.linkSession(session.running.pid, session.path);
		if (viewing?.path !== session.path) return;
		viewing.writable = true;
		$("viewer-label").textContent = `In corso nel terminale · ${session.project} · scrivi qui: arriva a quel Pi`;
		$("composer").classList.remove("readonly");
		input.placeholder = "Scrivi al Pi nel terminale…";
		input.focus();
	} catch (error) {
		if (viewing?.path !== session.path) return;
		$("viewer-label").textContent = `In corso nel terminale · ${session.project} · sola lettura: ${clean(error.message)}`;
	}
}

window.desk.on("session-append", ({ path, items }) => {
	if (viewing?.path !== path) return;
	const near = nearEnd();
	renderItems(viewer, items);
	keepEnd(near);
});

$("viewer-resume").onclick = async () => {
	const session = viewing;
	const items = await window.desk.resumeSession(session.path, session.cwd);
	log.replaceChildren();
	renderItems(log, items);
	log.appendChild(el("div", "note")).textContent = `Sessione ripresa in ${session.cwd}`;
	showChat();
	scroll.scrollTop = scroll.scrollHeight;
};
$("viewer-back").onclick = showChat;
$("toggle-sessions").onclick = () => showSidebar(!app.classList.contains("sidebar-open"));
$("close-sidebar").onclick = () => showSidebar(false);
$("session-filter").oninput = refreshSessions;
$("new-session").onclick = async () => {
	await window.desk.newSession();
	log.replaceChildren();
	showChat();
};

// ---- Start -------------------------------------------------------------------------------------------------------------
if (store.get("pi-desk.sidebar") === "1") showSidebar(true);
setBusy(false, "pronto");
grow();
showEmpty();
sendRect();
input.focus();
