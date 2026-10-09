import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, siteOf, wantsBrowser } from "./browser.ts";

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
