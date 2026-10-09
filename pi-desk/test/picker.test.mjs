// The picker script in a real page: hover, click → the element (not pressed); Esc → null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PICKER_SCRIPT, pickedText } from "../picker.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { findChrome } = await import(join(repo, "extensions/browser/chrome.ts"));
const { BrowserSession } = await import(join(repo, "extensions/browser/session.ts"));

test("picking an element returns its role, name, selector and place; the page's click does not happen", { skip: !findChrome() && "Chrome non installato", timeout: 60_000 }, async () => {
	process.env.PI_BROWSER_HEADLESS = "1";
	const dir = mkdtempSync(join(tmpdir(), "picker-"));
	process.env.PI_BROWSER_PROFILE = join(dir, "profile");
	writeFileSync(join(dir, "p.html"), `<form id="f"><button class="primary big" onclick="window.pressed=true;return false">Salva ordine</button></form>`);
	const session = new BrowserSession();
	try {
		await session.open(`file://${join(dir, "p.html")}`);
		const js = (code) => session.evaluate(code);
		await js(`window.__pick = ${PICKER_SCRIPT}; "ok"`);
		await js(`const b = document.querySelector("button"); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); b.click(); "ok"`);
		const pick = JSON.parse(await js(`window.__pick.then((value) => JSON.stringify(value))`));
		assert.equal(pick.role, "button");
		assert.equal(pick.name, "Salva ordine");
		assert.equal(pick.selector, "#f > button.primary.big");
		assert.ok(pick.rect.width > 0);
		assert.equal(await js(`String(Boolean(window.pressed))`), "false", "the click was swallowed");
		assert.match(pickedText(pick), /button «Salva ordine»/);
		await js(`window.__pick2 = ${PICKER_SCRIPT}; document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); "ok"`);
		assert.equal(await js(`window.__pick2.then((value) => String(value))`), "null");
	} finally {
		session.close();
	}
});
