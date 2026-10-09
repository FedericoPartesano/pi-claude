import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "./browser/chrome.ts";
import { BrowserSession } from "./browser/session.ts";

const chrome = findChrome();

test("a real headless Chrome: open, act by ref, see only the difference, navigate, eval, logs, screenshot", { skip: !chrome && "Chrome non installato", timeout: 60_000 }, async () => {
	process.env.PI_BROWSER_HEADLESS = "1";
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-"));
	process.env.PI_BROWSER_PROFILE = join(dir, "profile");
	writeFileSync(join(dir, "next.html"), "<title>Fatto</title><h1>Ordine inviato</h1><a href='index.html'>Torna</a>");
	writeFileSync(
		join(dir, "index.html"),
		`<title>Negozio</title><h1>Carrello</h1><p id="n">2 articoli</p>
		<button onclick="document.getElementById('n').textContent='Carrello vuoto'">Svuota</button>
		<label>Codice <input id="c"></label>
		<select aria-label="Spedizione"><option>Standard</option><option>Express</option></select>
		<a href="next.html">Invia ordine</a>
		<script>console.error("errore di prova")</script>`,
	);
	const session = new BrowserSession({ shotsDir: join(dir, "shots") });
	try {
		const opened = await session.open(`file://${join(dir, "index.html")}`);
		assert.match(opened, /heading "Carrello"/);
		assert.match(opened, /text "2 articoli"/);
		const button = /\[(e\d+)\] button "Svuota"/.exec(opened)![1];
		const diff = await session.act(button, "click");
		assert.match(diff, /- - text "2 articoli"/);
		assert.match(diff, /\+ - text "Carrello vuoto"/);
		assert.ok(!/heading/.test(diff), "only the difference");
		const field = /\[(e\d+)\] textbox "Codice"/.exec(opened)![1];
		await session.act(field, "type", "SCONTO10");
		assert.equal(await session.evaluate("document.getElementById('c').value"), "SCONTO10");
		const select = /\[(e\d+)\] combobox "Spedizione"/.exec(opened)![1];
		await session.act(select, "select", "Express");
		assert.match(await session.evaluate("document.querySelector('select').value"), /Express/);
		assert.match(session.logs(), /errore di prova/);
		const link = /\[(e\d+)\] link "Invia ordine"/.exec(opened)![1];
		const next = await session.act(link, "click");
		assert.match(next, /nuova pagina/);
		assert.match(next, /heading "Ordine inviato"/);
		const shot = await session.screenshot();
		assert.ok(existsSync(shot.path));
	} finally {
		session.close();
		delete process.env.PI_BROWSER_HEADLESS;
		delete process.env.PI_BROWSER_PROFILE;
	}
});

test("downloads are listed newest first from the project's .pi/downloads", async () => {
	const { mkdtempSync, writeFileSync: write, utimesSync } = await import("node:fs");
	const dir = mkdtempSync(join(tmpdir(), "dl-"));
	const session = new BrowserSession({ downloadsDir: dir });
	assert.match(session.downloads(), /Nessun download/);
	write(join(dir, "old.pdf"), "x".repeat(2048));
	utimesSync(join(dir, "old.pdf"), new Date("2026-01-01"), new Date("2026-01-01"));
	write(join(dir, "report.pdf"), "x".repeat(4096));
	write(join(dir, "half.pdf.crdownload"), "x");
	const list = session.downloads();
	assert.ok(list.indexOf("report.pdf") < list.indexOf("old.pdf"));
	assert.ok(!list.includes("crdownload"));
	assert.match(list, /report.pdf · 4 KB/);
});
