import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikePiBug, parseDetect } from "./detect.ts";

test("looksLikePiBug: problemi di Pi o pi-claude", () => {
	for (const text of [
		"pi si blocca quando faccio auto-compact",
		"la modal di /memory non si apre",
		"il footer è sparito dopo il reload",
		"pi-claude va in crash all'avvio",
		"Alt+R non funziona",
		"This extension ctx is stale after session replacement",
	]) assert.equal(looksLikePiBug(text), "yes", text);
});

test("looksLikePiBug: cose che non riguardano Pi", () => {
	for (const text of [
		"scrivi una funzione che ordina una lista",
		"il mio codice dà errore su npm install",
		"docker non funziona, errore di rete",
		"c'è un bug nel mio server express",
		"ciao, come va?",
		"aggiungi un test per il parser",
	]) assert.equal(looksLikePiBug(text), "no", text);
});

test("looksLikePiBug: dubbio quando Pi e un altro programma sono nominati insieme o il riferimento è vago", () => {
	assert.equal(looksLikePiBug("pi non funziona con il mio docker"), "maybe");
	assert.equal(looksLikePiBug("la sessione è strana, si è duplicata la chat"), "maybe");
});

test("parseDetect: legge SI/NO", () => {
	assert.equal(parseDetect("SI"), true);
	assert.equal(parseDetect("Sì."), true);
	assert.equal(parseDetect("NO"), false);
	assert.equal(parseDetect(""), false);
});
