import { test } from "node:test";
import assert from "node:assert/strict";
import browser, { normalizeUrl, siteOf, wantsBrowser } from "./browser.ts";

test("the tool turns on only for requests about the web", () => {
	for (const prompt of ["apri https://example.com e dimmi il titolo", "prova il login su localhost:3000", "fai uno screenshot della pagina", "controlla nel browser se il bottone funziona", "clicca su Salva nella dashboard"]) assert.ok(wantsBrowser(prompt), prompt);
	for (const prompt of ["sistema la funzione di login in auth.ts", "aggiungi un test per il carrello", "ok", "rinomina la variabile url in href"]) assert.ok(!wantsBrowser(prompt), prompt);
});

test("sites to confirm: the origin; local pages need none", () => {
	assert.equal(siteOf("https://shop.example.com/cart?x=1"), "https://shop.example.com");
	assert.equal(siteOf("http://localhost:3000/login"), "http://localhost:3000");
	assert.equal(siteOf("file:///tmp/a.html"), undefined);
	assert.equal(siteOf("about:blank"), undefined);
});

test("bare hosts get a scheme", () => {
	assert.equal(normalizeUrl("example.com"), "https://example.com");
	assert.equal(normalizeUrl("localhost:3000/x"), "http://localhost:3000/x");
	assert.equal(normalizeUrl("http://a.it"), "http://a.it");
	assert.equal(normalizeUrl("file:///tmp/a.html"), "file:///tmp/a.html");
});

test("auto mode step: external sites refused without asking (no Chrome started)", async () => {
	const tools: Record<string, any> = {};
	const pi = { on: () => {}, registerTool: (tool: any) => (tools[tool.name] = tool), registerCommand: () => {}, getActiveTools: () => [], setActiveTools: () => {} } as any;
	process.env.PI_AUTO_PHASE = "build";
	try {
		browser(pi);
		const ctx = { cwd: "/tmp", hasUI: false, ui: {} } as any;
		const result = await tools.browser.execute("1", { action: "open", url: "https://example.com" }, undefined, undefined, ctx);
		assert.match(result.content[0].text, /solo pagine locali.*https:\/\/example\.com/);
	} finally {
		delete process.env.PI_AUTO_PHASE;
	}
});
