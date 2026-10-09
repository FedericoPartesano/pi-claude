// The chat page in a real headless Chrome with a fake bridge: a whole turn, a dialog, statuses, the address bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { findChrome } = await import(join(repo, "extensions/browser/chrome.ts"));
const { BrowserSession } = await import(join(repo, "extensions/browser/session.ts"));

test("chat UI: user message, streamed markdown, tool lines, confirm dialog answered, statuses, address bar", { skip: !findChrome() && "Chrome non installato", timeout: 60_000 }, async () => {
	process.env.PI_BROWSER_HEADLESS = "1";
	process.env.PI_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), "desk-ui-"));
	const session = new BrowserSession();
	const js = (code) => session.evaluate(code);
	try {
		await session.open(`file://${fileURLToPath(new URL("./ui-harness.html", import.meta.url))}`);
		// Hidden overlays must not take the clicks (#dialog had display:grid, which beat [hidden]: every click hit it).
		const under = await js(`[document.elementFromPoint(40, 22), document.elementFromPoint(200, 300)].map((e) => e?.id || e?.className).join(",")`);
		assert.ok(!/dialog|viewer-bar/.test(under), `under the mouse: ${under}`);
		// The user sends with Enter.
		await js(`input.value = "apri example.com"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /"prompt","apri example.com"/);
		assert.equal(await js(`document.querySelector(".msg.user").textContent`), "apri example.com");
		// A turn: streaming text with markdown, a tool that runs and ends.
		await js(`emit("pi-event", { type: "agent_start" }); emit("pi-event", { type: "message_start", message: { role: "assistant" } });
			emit("pi-event", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Apro **la pagina** con " } });
			emit("pi-event", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "\`browser\`<script>x</script>" } });
			emit("pi-event", { type: "tool_execution_start", toolCallId: "t1", toolName: "browser", args: { action: "open", url: "https://example.com" } }); "ok"`);
		assert.equal(await js(`document.getElementById("status").textContent`), "sta lavorando…");
		assert.equal(await js(`document.getElementById("stop").hidden`), "false");
		const html = await js(`document.querySelector(".msg.assistant").innerHTML`);
		assert.match(html, /<strong>la pagina<\/strong>/);
		assert.match(html, /<code>browser<\/code>/);
		assert.ok(!/<script>/.test(html), "page text is escaped");
		assert.equal(await js(`document.querySelector(".tool").className`), "tool run");
		// A confirm dialog from pi-browser, answered Sì.
		await js(`emit("pi-ui", { type: "extension_ui_request", id: "u1", method: "confirm", title: "pi-browser", message: "Aprire https://example.com?" }); "ok"`);
		assert.equal(await js(`document.getElementById("dialog").hidden`), "false");
		await js(`[...document.querySelectorAll("#dialog-actions button")].find((b) => b.textContent === "Sì").click(); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /"answer","u1",\{"confirmed":true\}/);
		assert.equal(await js(`document.getElementById("dialog").hidden`), "true");
		// Status lines, tool end, settle.
		await js(`emit("pi-ui", { type: "extension_ui_request", id: "s", method: "setStatus", statusKey: "browser", statusText: "🌐 https://example.com" });
			emit("pi-event", { type: "tool_execution_end", toolCallId: "t1", isError: false }); emit("pi-event", { type: "agent_settled" }); "ok"`);
		assert.equal(await js(`document.getElementById("chips").textContent`), "🌐 https://example.com");
		assert.equal(await js(`document.querySelector(".tool").className`), "tool ok");
		assert.equal(await js(`document.getElementById("status").textContent`), "pronto");
		// The address bar follows the panel and navigates it.
		await js(`emit("browser-url", { url: "https://example.com/", title: "Example Domain", back: true, forward: false }); "ok"`);
		assert.equal(await js(`document.getElementById("url").value`), "https://example.com/");
		assert.equal(await js(`document.getElementById("forward").disabled`), "true");
		await js(`url.value = "localhost:3000"; url.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /"browser","go","localhost:3000"/);
		// Esc while busy aborts.
		await js(`emit("pi-event", { type: "agent_start" }); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); "ok"`);
		assert.match(await js(`JSON.stringify(calls)`), /\["abort"\]/);
	} finally {
		session.close();
	}
});

test("sessions: running first with badges, a running one read-only and live, a closed one resumed here", { skip: !findChrome() && "Chrome non installato", timeout: 60_000 }, async () => {
	process.env.PI_BROWSER_HEADLESS = "1";
	process.env.PI_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), "desk-ui-"));
	const session = new BrowserSession();
	const js = (code) => session.evaluate(code);
	const wait = () => new Promise((resolve) => setTimeout(resolve, 150));
	try {
		await session.open(`file://${fileURLToPath(new URL("./ui-harness.html", import.meta.url))}`);
		await js(`document.getElementById("toggle-sessions").click(); "ok"`);
		await wait();
		const list = await js(`document.getElementById("session-list").innerText`);
		assert.match(list, /IN CORSO|In corso/i);
		assert.ok(list.indexOf("sistema il carrello") < list.indexOf("post di ottobre"), "running first");
		assert.match(list, /in corso · pid 42/);
		assert.match(list, /questa finestra/);
		// A session running in another Pi: read-only, follows appends.
		await js(`[...document.querySelectorAll(".session")].find((b) => b.innerText.includes("carrello")).click(); "ok"`);
		await wait();
		assert.equal(await js(`document.getElementById("viewer").hidden`), "false");
		assert.match(await js(`document.getElementById("viewer-label").textContent`), /scrivi qui/);
		assert.equal(await js(`document.getElementById("viewer-resume").hidden`), "true", "a running session is not resumed: it is written through its Pi");
		assert.ok(!/readonly/.test(await js(`document.getElementById("composer").className`)), "writable through desk-link");
		await js(`input.value = "aggiungi i test"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); "ok"`);
		await wait();
		assert.match(await js(`JSON.stringify(calls)`), /"send",42,"aggiungi i test"/);
		assert.match(await js(`document.getElementById("viewer").innerText`), /in coda/);
		assert.ok(!/"prompt","aggiungi i test"/.test(await js(`JSON.stringify(calls)`)), "never sent to this window's Pi");
		assert.match(await js(`document.getElementById("viewer").innerHTML`), /<strong>fatto<\/strong>/);
		await js(`emit("session-append", { path: "/s/live", items: [{ role: "assistant", text: "nuovo passo" }] }); "ok"`);
		assert.match(await js(`document.getElementById("viewer").innerText`), /nuovo passo/);
		await js(`emit("session-append", { path: "/s/other", items: [{ role: "assistant", text: "di un'altra" }] }); "ok"`);
		assert.ok(!/di un'altra/.test(await js(`document.getElementById("viewer").innerText`)));
		// A running Pi without desk-link: read only, with the reason.
		await js(`document.getElementById("toggle-sessions").click(); "ok"`);
		await wait();
		await js(`[...document.querySelectorAll(".session")].find((b) => b.innerText.includes("vecchio pi")).click(); "ok"`);
		await wait();
		assert.match(await js(`document.getElementById("viewer-label").textContent`), /sola lettura: .*riavvialo/);
		assert.match(await js(`document.getElementById("composer").className`), /readonly/);
		// A closed session: resumed here, its history becomes the chat.
		await js(`document.getElementById("toggle-sessions").click(); "ok"`);
		await wait();
		await js(`[...document.querySelectorAll(".session")].find((b) => b.innerText.includes("ottobre")).click(); "ok"`);
		await wait();
		assert.equal(await js(`document.getElementById("viewer-resume").hidden`), "false");
		await js(`document.getElementById("viewer-resume").click(); "ok"`);
		await wait();
		assert.match(await js(`JSON.stringify(calls)`), /"resume","\/s\/old","\/p\/blog"/);
		assert.equal(await js(`document.getElementById("viewer").hidden`), "true");
		assert.match(await js(`document.getElementById("log").innerText`), /scrivi il post/);
		assert.ok(!/readonly/.test(await js(`document.getElementById("composer").className`)));
	} finally {
		session.close();
	}
});
