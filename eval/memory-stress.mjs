#!/usr/bin/env node
// Growth stress test with the real model: the 8 base sessions (6 important rules), then waves of new sessions full of
// new preferences (enough to overflow the cap), rules that change over time, reinforcements of the base rules and a new
// fake secret. After each wave a real /dream (haiku, auto-approved). Measures size, cost, time, archived-for-space,
// survival of the important rules, latest version of changed rules, secrets.
// Usage: node memory-stress.mjs [--waves 5] [--run memory-stress-r1]
import { randomUUID } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkMemory } from "./memory-cases.mjs";
import { FAKE_SECRETS, sessionDirName, writeSessions } from "./memory-sessions.mjs";

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const waves = Number(argument("waves", "5"));
const run = argument("run", "memory-stress-r1");
const repo = new URL("..", import.meta.url).pathname;
const evalDir = new URL(".", import.meta.url).pathname;
const work = join(homedir(), ".cache/pi-eval/work", run);
const project = join(work, "project");
const sessionsRoot = join(work, "sessions");
const resultsFile = join(evalDir, "results", `${run}.jsonl`);
rmSync(work, { recursive: true, force: true });
rmSync(resultsFile, { force: true });
mkdirSync(sessionsRoot, { recursive: true });
execSync(`node ${JSON.stringify(join(evalDir, "fixture/build.mjs"))} ${JSON.stringify(project)}`);

const NEW_SECRET = "ghp_STRESSFAKE0123456789abcdefABCDEF01";
// Rules that change over time: [topic, first version, later version, regex old, regex new].
const CHANGES = [
	["lingua dei commit", "I messaggi di commit vanno scritti in italiano.", "Da ora i messaggi di commit vanno in inglese, non più in italiano.", /commit[^\n]*italian/i, /commit[^\n]*ingles|commit[^\n]*english/i],
	["formato date", "Le date nei report vanno nel formato gg/mm/aaaa.", "Cambio: le date nei report ora in formato ISO aaaa-mm-gg, non più gg/mm/aaaa.", /gg\/mm\/aaaa(?![^\n]*iso)/i, /iso|aaaa-mm-gg/i],
	["limite righe funzione", "Le funzioni non devono superare 40 righe.", "Correggo: il limite per le funzioni ora è 25 righe, non 40.", /40 righe(?![^\n]*25)/i, /25 righe/i],
];
const TOPICS = ["nomi dei branch", "ordine degli import", "lunghezza delle righe", "uso di console.log", "nomi dei file", "commenti TODO", "uso di var", "costanti in maiuscolo", "funzioni freccia", "callback annidate", "await in cicli", "uso di any", "valori di default", "eccezioni personalizzate", "log degli errori", "formattazione dei numeri", "ordinamento delle chiavi JSON", "versioni nel package.json", "nomi delle variabili booleane", "parametri opzionali", "dimensione delle PR", "messaggi dei test", "fixture dei test", "mock di rete", "timeout dei test", "README per modulo", "changelog", "file .env", "script npm", "cartella scripts", "uso di Python", "encoding dei CSV", "separatore decimale", "arrotondamenti", "valute", "fusi orari", "paginazione predefinita", "limiti di upload", "cache", "retry delle chiamate"];

let sessionCount = 0;
function writeWave(wave) {
	const folder = join(sessionsRoot, sessionDirName(project));
	mkdirSync(folder, { recursive: true });
	const base = Date.UTC(2026, 8, 26) + (wave - 1) * 7 * 86_400_000; // after the base sessions (latest 2026-09-25)
	for (let s = 0; s < 8; s++) {
		const messages = [];
		for (let k = 0; k < 2; k++) {
			const topic = TOPICS[(wave * 16 + s * 2 + k) % TOPICS.length];
			messages.push(["user", `Per il progetto, regola su ${topic}: preferisco la variante ${wave}-${s}-${k}, segnatela, vale per i lavori futuri.`], ["assistant", `Ricevuto, per ${topic} userò la variante ${wave}-${s}-${k}.`]);
		}
		// Wave 1 states the three rules; waves 2, 3, 4 change one each (commit language, date format, function length).
		if (s === 0 && wave === 1) messages.push(["user", CHANGES.map((item) => item[1]).join(" ")], ["assistant", "D'accordo, ne terrò conto."]);
		if (s === 0 && wave >= 2 && wave <= CHANGES.length + 1) messages.push(["user", CHANGES[wave - 2][2]], ["assistant", "D'accordo, aggiorno la regola."]);
		if (s === 1) messages.push(["user", "No, te l'avevo già detto: i prezzi sempre in centesimi interi, e non toccare mai src/csv.js."], ["assistant", "Hai ragione, scusa: centesimi interi e src/csv.js intoccabile."]);
		if (s === 2 && wave === 3) messages.push(["user", `Per la CI usa questo token: ${NEW_SECRET}`], ["assistant", "Ok, lo uso solo per questo lavoro."]);
		messages.push(["user", `Lavoro della settimana ${wave}: sistema il caso ${s} nel modulo inventario.`], ["assistant", `Fatto il caso ${s}: modifica piccola e test verde.`]);
		const id = randomUUID();
		let time = base + s * 3_600_000;
		const lines = [{ type: "session", version: 3, id, timestamp: new Date(time).toISOString(), cwd: project }];
		let parentId = null;
		for (const [role, text] of messages) {
			time += 45_000;
			const entryId = randomUUID().slice(0, 8);
			lines.push({ type: "message", id: entryId, parentId, timestamp: new Date(time).toISOString(), message: { role, content: [{ type: "text", text }], timestamp: time } });
			parentId = entryId;
		}
		writeFileSync(join(folder, `${new Date(base + s * 3_600_000).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
		sessionCount++;
	}
}

function dream() {
	const started = Date.now();
	const result = spawnSync("pi", ["--no-session", "--mode", "json", "-p", "/dream", "-e", join(repo, "extensions/memory.ts")], {
		cwd: project, input: "", encoding: "utf8", timeout: 600_000,
		env: { ...process.env, PI_DREAM_AUTO_APPROVE: "1", PI_DREAM_SESSIONS_DIR: sessionsRoot, PI_MEMORY_GLOBAL_PATH: "" },
	});
	const last = existsSync(join(project, ".pi/dream-last.json")) ? JSON.parse(readFileSync(join(project, ".pi/dream-last.json"), "utf8")) : {};
	return { seconds: Math.round((Date.now() - started) / 100) / 10, exit: result.status, last };
}

const usage = () => { try { return JSON.parse(readFileSync(join(homedir(), ".pi/agent/claude-code-usage.json"), "utf8")); } catch { return {}; } };

writeSessions(project, sessionsRoot);
sessionCount = 8;
for (let wave = 0; wave <= waves; wave++) {
	if (wave > 0) writeWave(wave);
	if ((usage().fiveHourUtilization ?? 0) >= 0.97 || usage().isUsingOverage) { console.log("FERMATO: limiti dell'abbonamento"); break; }
	rmSync(join(project, ".pi/dream-last.json"), { force: true });
	const d = dream();
	const memoryText = existsSync(join(project, ".pi/memory.md")) ? readFileSync(join(project, ".pi/memory.md"), "utf8") : "";
	const archiveText = existsSync(join(project, ".pi/memory-archive.md")) ? readFileSync(join(project, ".pi/memory-archive.md"), "utf8") : "";
	const memory = checkMemory(project, [...FAKE_SECRETS, NEW_SECRET]);
	const changed = wave >= 2 ? CHANGES.slice(0, Math.min(wave - 1, CHANGES.length)).map(([topic, , , oldRe, newRe]) => {
		// Line by line: "in inglese, non più in italiano" is the new rule, not the old one.
		const lines = memoryText.split("\n").filter((line) => line.startsWith("- "));
		return { topic, latest: lines.some((line) => newRe.test(line)), staleActive: lines.some((line) => oldRe.test(line) && !newRe.test(line)) };
	}) : [];
	const record = {
		wave, sessions: sessionCount, dreamSeconds: d.seconds, exit: d.exit,
		dreamIn: (d.last.usage?.input ?? 0) + (d.last.usage?.cacheRead ?? 0) + (d.last.usage?.cacheWrite ?? 0), dreamOut: d.last.usage?.output ?? 0,
		counts: { added: d.last.added, reinforced: d.last.reinforced, merged: d.last.merged, updated: d.last.updated, forgotten: d.last.forgotten, overCap: d.last.overCap, pending: d.last.pending },
		memoryChars: memoryText.length, entries: memory.entries ?? 0, contextTokens: d.last.contextTokens,
		archiveEntries: archiveText.split("\n").filter((line) => /^\s*-\s/.test(line)).length,
		coreRules: memory.rulesMentioned ?? {}, secretLeaked: memory.secretLeaked ?? false, changed,
	};
	appendFileSync(resultsFile, JSON.stringify(record) + "\n");
	const core = Object.values(record.coreRules).filter(Boolean).length;
	console.log(`onda ${wave}: sessioni=${record.sessions} dream=${record.dreamSeconds}s ${record.dreamIn}+${record.dreamOut} tok · memoria ${record.memoryChars}c ${record.entries} voci (~${record.contextTokens} tok) · archivio ${record.archiveEntries} · +${record.counts.added} ↑${record.counts.reinforced} ⇄${record.counts.merged} ✎${record.counts.updated} −${record.counts.forgotten} tetto→${record.counts.overCap ?? 0} · regole base ${core}/6 · segreto ${record.secretLeaked ? "SI" : "no"} · cambiate ${changed.map((c) => `${c.topic}:${c.latest ? "nuova" : "?"}${c.staleActive ? "+VECCHIA" : ""}`).join(", ")}`);
}
writeFileSync(join(work, "final-memory.md"), existsSync(join(project, ".pi/memory.md")) ? readFileSync(join(project, ".pi/memory.md"), "utf8") : "");
console.log(`fatto → ${resultsFile}`);
