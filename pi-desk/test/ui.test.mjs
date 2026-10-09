// The real chat page (ui/index.html) in headless Chrome with a fake bridge (test/mock-desk.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = new URL(".", import.meta.url);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const { findChrome } = await import(join(repo, "extensions/browser/chrome.ts"));
const { BrowserSession } = await import(join(repo, "extensions/browser/session.ts"));
const skip = !findChrome() && "Chrome non installato";

/** The built page (ui-dist, from `vite build`), without its CSP and with the mock bridge loaded first. */
async function openPage() {
	const ui = fileURLToPath(new URL("../ui-dist/", import.meta.url));
	const harness = join(ui, "_test.html");
	copyFileSync(fileURLToPath(new URL("./mock-desk.js", here)), join(ui, "_mock-desk.js"));
	const html = readFileSync(join(ui, "index.html"), "utf8").replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "").replace("<script defer", '<script src="./_mock-desk.js"></script><script defer');
	writeFileSync(harness, html);
	process.env.PI_BROWSER_HEADLESS = "1";
	process.env.PI_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), "desk-ui-"));
	const session = new BrowserSession();
	await session.open(`file://${harness}`);
	const js = (code) => session.evaluate(code);
	await wait(200);
	const close = () => {
		session.close();
		rmSync(harness, { force: true });
		rmSync(join(ui, "_mock-desk.js"), { force: true });
	};
	return { js, close };
}
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

test("a whole turn: user bubble, thinking, streamed markdown with a chart, tool steps, a dialog, suggestions", { skip, timeout: 60_000 }, async () => {
	const { js, close } = await openPage();
	try {
		// Nothing hidden takes the clicks (a display rule once beat [hidden] and every click hit the dialog).
		assert.ok(!/dialog|viewer-bar/.test(await js(`[document.elementFromPoint(40, 26), document.elementFromPoint(300, 400)].map((e) => e?.id || e?.className).join(",")`)));
		assert.equal(await js(`String(Boolean(document.getElementById("empty")))`), "true", "empty state first");
		// The browser panel starts closed (no wasted space) and reports no area for the native view.
		assert.equal(await js(`getComputedStyle(document.getElementById("browser")).display`), "none");
		assert.match(await js(`JSON.stringify(window.lastRect)`), /"width":0/);
		await js(`document.getElementById("toggle-browser").click(); "ok"`);
		await wait(50);
		assert.notEqual(await js(`getComputedStyle(document.getElementById("browser")).display`), "none");
		assert.ok(Number(await js(`String(window.lastRect.width)`)) > 100);
		await js(`document.getElementById("close-browser").click(); "ok"`);
		await wait(50);
		assert.equal(await js(`getComputedStyle(document.getElementById("browser")).display`), "none");
		await js(`input.value = "fammi un grafico"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /"prompt","fammi un grafico"/);
		assert.equal(await js(`document.querySelector(".turn-user").textContent`), "fammi un grafico");
		assert.equal(await js(`String(Boolean(document.getElementById("empty")))`), "false");
		const delta = (type, text) => `emit("pi-event", { type: "message_update", assistantMessageEvent: { type: "${type}", delta: ${JSON.stringify(text)} } });`;
		await js(`emit("pi-event", { type: "agent_start" }); emit("pi-event", { type: "message_start", message: { role: "assistant" } });
			${delta("thinking_delta", "Devo contare le vendite…")} ${delta("text_delta", "## Vendite\n\n1. **gennaio** alto\n2. febbraio\n\n| mese | k€ |\n|---|---:|\n| gen | 3 |\n\n")}
			${delta("text_delta", '```grafico\n{"tipo":"barre","titolo":"Vendite","etichette":["gen","feb"],"serie":[{"nome":"2026","valori":[3,5]}],"unita":"k€"}\n```\n<!--suggerimenti-->\n- confronta col 2025\n- esporta in CSV')} "ok"`);
		await wait(80);
		assert.equal(await js(`String(document.querySelector(".thinking-head").hasAttribute("data-expanded"))`), "false", "thinking collapses when the answer starts");
		const html = await js(`document.querySelector(".turn-pi .md").innerHTML`);
		assert.match(html, /<h2>Vendite<\/h2>/);
		assert.match(html, /<ol><li><strong>gennaio<\/strong> alto<\/li>/);
		assert.match(html, /<table>/);
		assert.match(html, /<figure class="chart">/);
		assert.ok(!/suggerimenti|confronta col 2025/.test(html), "suggestions are not in the text");
		await js(`emit("pi-event", { type: "message_end", message: { role: "assistant" } });
			emit("pi-event", { type: "tool_execution_start", toolCallId: "t1", toolName: "browser", args: { action: "open", url: "https://example.com" } }); "ok"`);
		assert.match(await js(`document.getElementById("status").textContent`), /browser open https:\/\/example.com/);
		assert.notEqual(await js(`getComputedStyle(document.getElementById("browser")).display`), "none", "opens when Pi uses the browser");
		assert.match(await js(`document.querySelector(".step").className`), /\bstep run\b/);
		await js(`emit("pi-ui", { type: "extension_ui_request", id: "u1", method: "confirm", title: "pi-browser", message: "Aprire https://example.com?" }); "ok"`);
		await js(`document.querySelector(".dialog-actions .primary").click(); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /"answer","u1",\{"confirmed":true\}/);
		await js(`emit("pi-event", { type: "tool_execution_end", toolCallId: "t1", isError: false, result: { content: [{ type: "text", text: "Example Domain" }] } });
			emit("pi-event", { type: "message_start", message: { role: "assistant" } }); ${delta("text_delta", "Fatto.\n<!--suggerimenti-->\n- confronta col 2025\n- esporta in CSV")}
			emit("pi-event", { type: "message_end", message: { role: "assistant" } }); emit("pi-event", { type: "agent_settled" }); "ok"`);
		await wait(80);
		assert.match(await js(`document.querySelector(".step").className`), /\bstep ok\b/);
		await js(`document.querySelector(".step .head").click(); "ok"`);
		assert.match(await js(`document.querySelector(".step.open .out").textContent`), /Example Domain/);
		assert.equal(await js(`[...document.querySelectorAll(".suggestions button")].map((b) => b.textContent).join("|")`), "confronta col 2025|esporta in CSV");
		await js(`document.querySelector(".suggestions button").click(); "ok"`);
		assert.equal(await js(`input.value`), "confronta col 2025");
		assert.equal(await js(`document.getElementById("status").textContent`), "pronto");
		// Links open in the browser panel; the panel's place is reported.
		await js(`document.querySelector(".turn-pi .md").insertAdjacentHTML("beforeend", '<a href="https://a.it">a</a>'); document.querySelector('.md a[href="https://a.it"]').click(); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /"browser","go","https:\/\/a.it"/);
		assert.match(await js(`JSON.stringify(window.lastRect)`), /"width":\d+/);
		await js(`emit("pi-event", { type: "agent_start" }); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /\["abort"\]/);
	} finally {
		close();
	}
});

test("sessions sidebar: running first, live one writable through desk-link, legacy read-only with a clean reason, closed one resumed", { skip, timeout: 60_000 }, async () => {
	const { js, close } = await openPage();
	try {
		await js(`document.getElementById("toggle-sessions").click(); "ok"`);
		await wait();
		const list = await js(`document.getElementById("session-list").innerText`);
		assert.ok(list.indexOf("sistema il carrello") < list.indexOf("post di ottobre"), "running first");
		assert.match(list, /In corso/i);
		assert.match(list, /questa finestra/);
		await js(`[...document.querySelectorAll(".session")].find((b) => b.innerText.includes("carrello")).click(); "ok"`);
		await wait();
		assert.match(await js(`document.getElementById("viewer-label").textContent`), /scrivi qui/);
		assert.ok(!/readonly/.test(await js(`document.getElementById("composer").className`)));
		assert.match(await js(`document.getElementById("scroll").innerHTML`), /<strong>fatto<\/strong>/);
		await js(`input.value = "aggiungi i test"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); "ok"`);
		await wait();
		assert.match(await js(`JSON.stringify(calls)`), /"send",42,"aggiungi i test"/);
		assert.ok(!/"prompt","aggiungi i test"/.test(await js(`JSON.stringify(calls)`)));
		await js(`emit("session-append", { path: "/s/live", items: [{ role: "assistant", text: "nuovo passo" }] }); "ok"`);
		assert.match(await js(`document.getElementById("scroll").textContent`), /nuovo passo/);
		await js(`[...document.querySelectorAll(".session")].find((b) => b.innerText.includes("vecchio pi")).click(); "ok"`);
		await wait();
		const label = await js(`document.getElementById("viewer-label").textContent`);
		assert.match(label, /sola lettura: questo Pi non ha desk-link/);
		assert.ok(!/Error invoking/.test(label), "no technical prefix");
		await js(`[...document.querySelectorAll(".session")].find((b) => b.innerText.includes("ottobre")).click(); "ok"`);
		await wait();
		await js(`document.getElementById("viewer-resume").click(); "ok"`);
		await wait();
		assert.match(await js(`JSON.stringify(calls)`), /"resume","\/s\/old","\/p\/blog"/);
		assert.match(await js(`document.getElementById("scroll").textContent`), /scrivi il post/);
		assert.equal(await js(`String(Boolean(document.getElementById("viewer-bar")))`), "false");
	} finally {
		close();
	}
});

test("document panel: a step's file opens as a sortable table in its own tab; a PDF goes to the browser", { skip, timeout: 60_000 }, async () => {
	const { js, close } = await openPage();
	try {
		await js(`emit("pi-event", { type: "agent_start" });
			emit("pi-event", { type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "dati/vendite.csv" } });
			emit("pi-event", { type: "tool_execution_end", toolCallId: "r1", isError: false, result: { content: [{ type: "text", text: "mese,k€" }] } });
			emit("pi-event", { type: "agent_settled" }); "ok"`);
		await wait(80);
		await js(`document.querySelector(".step .view").click(); "ok"`);
		await wait(150);
		assert.match(await js(`JSON.stringify(calls)`), /"file","dati\/vendite.csv"/);
		assert.match(await js(`document.querySelector("#browser .tabs").textContent`), /vendite.csv/);
		const cells = () => js(`[...document.querySelectorAll(".doc-table tbody tr")].map((r) => r.cells[1].textContent).join(",")`);
		assert.equal(await cells(), "5,30,12");
		await js(`[...document.querySelectorAll(".doc-table th")][1].click(); "ok"`);
		assert.equal(await cells(), "5,12,30", "numbers sorted as numbers");
		await js(`[...document.querySelectorAll(".doc-table th")][1].click(); "ok"`);
		assert.equal(await cells(), "30,12,5");
		assert.equal(await js(`JSON.stringify(window.lastRect)`).then((r) => JSON.parse(r).width), 0, "native browser hidden under the document");
		await js(`window.__open = true; "ok"`);
	} finally {
		close();
	}
});
