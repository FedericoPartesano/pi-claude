import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { loadRouter, route } from "./skills-router.ts";

const dir = join(import.meta.dirname, "..", "skills");
const router = loadRouter(dir);
const names = (message: string, extra: Partial<Parameters<typeof route>[1]> = {}) => route(router, { message, ...extra }).map((a) => a.skill.split("/").pop());

test("il contratto si carica e ogni skill della regola esiste", async () => {
	const { existsSync } = await import("node:fs");
	assert.ok(router.rules.length >= 10);
	for (const rule of router.rules) assert.ok(existsSync(join(dir, rule.skill, "SKILL.md")), rule.skill);
});

test("il testo attiva la skill giusta con il motivo", () => {
	const [hit] = route(router, { message: "il parser non funziona, risolvi il bug" });
	assert.equal(hit.skill.split("/").pop(), "debugging-and-error-recovery");
	assert.deepEqual(hit.signals, ["text"]);
	assert.match(hit.reason, /^testo: «/);
	assert.deepEqual(names("fai la review del codice"), ["code-review-and-quality"]);
	assert.deepEqual(names("scrivi i test prima, tdd"), ["test-driven-development"]);
});

test("un messaggio neutro non attiva niente", () => {
	assert.deepEqual(names("ciao, come va?"), []);
	assert.deepEqual(names("leggi il file package.json"), []);
});

test("sotto soglia (peso 1) non scatta, con un secondo segnale sì", () => {
	assert.deepEqual(names("il componente è bello"), []);
	assert.deepEqual(names("il componente è bello", { repo: { files: ["src/App.tsx"] } }), ["frontend-ui-engineering"]);
});

test("una parola chiave in un discorso non scatta; con una richiesta sì", () => {
	assert.deepEqual(names("hai fatto il deploy?"), []);
	assert.deepEqual(names("posso fare deploy?"), []);
	assert.deepEqual(names("puoi fare il deploy?"), ["shipping-and-launch"]);
	assert.deepEqual(names("controlla i test e correggi"), ["test-driven-development"]);
});

test("veto: testo dei hook, tempo passato, URL e messaggi lunghi non attivano", () => {
	assert.deepEqual(names("Stop hook feedback:\n[finisci la roadmap]: piano non finito, pianifica"), []);
	assert.deepEqual(names("deploy fatto"), []);
	assert.deepEqual(names("vedi http://x.it/api/deploy"), []);
	assert.deepEqual(names("fai la review " + "x".repeat(700)), []);
});

test("contesto repo: test rossi attivano il debug anche senza parole chiave", () => {
	assert.deepEqual(names("vai avanti", { repo: { testsFailing: true } }), ["debugging-and-error-recovery"]);
});

test("cronologia: una skill già attiva o spenta non riparte", () => {
	const skill = "agent-skills/skills/code-review-and-quality";
	assert.deepEqual(names("review per favore", { active: new Set([skill]) }), []);
	assert.deepEqual(names("review per favore", { disabled: new Set([skill]) }), []);
});

test("/skill:nome esplicito spegne il router; altri comandi contano solo per nome", () => {
	assert.deepEqual(names("/skill:tdd c'è un bug"), []);
	assert.deepEqual(names("/goal sistema il bug"), []);
	assert.deepEqual(names("/review"), ["code-review-and-quality"]);
});

test("tetto per turno e ordine per punteggio", () => {
	const got = route(router, { message: "bug nell'api, ottimizza le prestazioni e fai la review", repo: { testsFailing: true } });
	assert.equal(got.length, router.maxPerTurn);
	assert.ok(got[0].score >= got[1].score);
});

test("file mancante o rotto: router che non scatta mai", () => {
	const empty = loadRouter(join(dir, "inesistente"));
	assert.deepEqual(route(empty, { message: "bug crash review" }), []);
});

test("velocità: ≤ 5 ms a messaggio", () => {
	const t = process.hrtime.bigint();
	for (let i = 0; i < 200; i++) route(router, { message: "c'è un bug nell'api e vorrei una review del codice con test", repo: { files: ["a.tsx", "b.ts"], testsFailing: true } });
	const ms = Number(process.hrtime.bigint() - t) / 1e6 / 200;
	assert.ok(ms < 5, `${ms} ms`);
});

test("fasce: un segnale forte inietta (auto), uno debole solo suggerisce", () => {
	const [strong] = route(router, { message: "committa e pusha il fix" });
	assert.equal(strong.tier, "auto");
	const [weak] = route(router, { message: "c'è un bug nel parser" });
	assert.equal(weak, undefined);
	const [mid] = route(router, { message: "controlla i test e il branch" });
	assert.ok(!mid || mid.tier === "suggest");
});
