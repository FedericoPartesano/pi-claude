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
