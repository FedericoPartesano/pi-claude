// End-to-end test of /dream doubts: a real `pi -p /dream` (the real extension, the real model) on a prepared memory and
// synthetic sessions, then what was saved is checked: which memories changed, which doubts were left.
// Usage: node --disable-warning=ExperimentalWarning eval/dream-doubts.mjs [--repeat 3] [--cases a,b] [--ask 0]
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionDirName } from "./memory-sessions.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const { saveStore } = await import(join(repo, "pi-memory/src/store.ts"));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repeat = Number(arg("repeat", "3"));
const ask = arg("ask", "1");
const only = arg("cases", "").split(",").filter(Boolean);

const rec = (id, type, text, extra = {}) => ({ id, type, text, pinned: false, confirmations: 2, created: "2026-09-20", last: "2026-09-28", status: "active", entities: [], ...extra });
const BASE = [
	rec("r1", "preferenza", "Usare npm come package manager."),
	rec("r2", "decisione", "I test si lanciano con node --test."),
	rec("r3", "preferenza", "Indentare il codice con i tab."),
	rec("r4", "preferenza", "Messaggi di commit in italiano."),
];
const text = (record) => record.text;

// expect(result): result = { records, doubts } → { ok, why }.  changed(id) = the memory was edited or superseded or gone.
const CASES = [
	{
		id: "chiara-ovunque", what: "contraddizione netta e senza eccezioni: deve decidere da solo",
		sessions: [["user", "Da adesso in tutti i progetti usa pnpm e mai npm, è deciso, ho migrato tutto."], ["assistant", "Perfetto, userò pnpm ovunque."], ["user", "Ricordalo, non devo più ripeterlo."]],
		check: ({ changed, doubts }) => ({ ok: changed("r1") && !doubts.some((d) => d.id === "r1"), why: "r1 aggiornato senza domande" }),
	},
	{
		id: "eccezione", what: "contraddizione con eccezione dichiarata a metà: deve chiedere, non cambiare alla cieca",
		sessions: [["user", "Per il nuovo servizio usa pnpm."], ["assistant", "Ok, pnpm per il nuovo servizio."], ["user", "Il vecchio repo legacy però resta su npm, non so ancora se migrarlo, vedremo."]],
		// A new memory that keeps the exception ("new service pnpm, legacy npm") is as good as a doubt: nothing is overwritten blindly.
		check: ({ doubts, records }) => ({ ok: doubts.some((d) => d.id === "r1") || records.some((record) => record.status === "active" && /legacy/i.test(record.text ?? "")), why: "dubbio su r1 oppure eccezione registrata in un ricordo" }),
	},
	{
		id: "una-tantum", what: "cambio solo per questo caso: r3 non deve cambiare",
		sessions: [["user", "In questo file specifico usa gli spazi invece dei tab, è codice generato da un tool."], ["assistant", "Ok, spazi solo in questo file."], ["user", "Per tutto il resto del progetto restano i tab ovviamente."]],
		check: ({ byId, changed }) => ({ ok: !changed("r3") && (byId("r3")?.text ?? "").match(/tab/i) !== null, why: "r3 intatto" }),
	},
	{
		id: "conferma", what: "sessione che conferma: nessun dubbio, nessun cambiamento",
		sessions: [["user", "Ricorda, i test li lancio sempre con node --test."], ["assistant", "Sì, node --test."], ["user", "E i commit in italiano come sempre."]],
		check: ({ doubts, changed }) => ({ ok: doubts.length === 0 && !changed("r2") && !changed("r4"), why: "0 dubbi, r2 e r4 intatti" }),
	},
	{
		id: "estraneo", what: "argomento nuovo senza legame: nessun dubbio",
		sessions: [["user", "Il database di staging gira su Postgres 16 sulla porta 5433."], ["assistant", "Annotato: Postgres 16, porta 5433."], ["user", "Le migrazioni vanno in db/migrations."]],
		check: ({ doubts, changed }) => ({ ok: doubts.length === 0 && !["r1", "r2", "r3", "r4"].some(changed), why: "0 dubbi, nessun ricordo toccato" }),
	},
	{
		id: "vago", what: "frase incerta e non una decisione: non deve modificare r4 alla cieca",
		sessions: [["user", "Boh, forse per i commit sarebbe meglio l'inglese, non saprei, ci devo pensare."], ["assistant", "Quando decidi dimmelo."], ["user", "Per ora lascia pure com'è."]],
		check: ({ changed }) => ({ ok: !changed("r4"), why: "r4 intatto" }),
	},
	{
		id: "ripensamento", what: "cambia idea e poi torna indietro nella stessa sessione: r3 intatto",
		sessions: [["user", "Passiamo agli spazi per l'indentazione."], ["assistant", "Ok, spazi."], ["user", "No aspetta, ho riprovato, i tab sono meglio. Restano i tab."], ["assistant", "Ok, tab confermati."]],
		check: ({ changed, byId }) => ({ ok: !changed("r3") && (byId("r3")?.text ?? "").match(/tab/i) !== null, why: "r3 intatto" }),
	},
	{
		id: "tanti", what: "quattro possibili contraddizioni ambigue: massimo 3 dubbi",
		sessions: [["user", "Mah, per qualche progetto uso yarn invece di npm."], ["user", "A volte lancio i test con vitest invece di node --test, dipende."], ["user", "Nel repo del cliente i tab sono vietati, ci vogliono due spazi."], ["user", "Con il cliente americano scrivo i commit in inglese."]],
		check: ({ doubts }) => ({ ok: doubts.length <= 3, why: "al massimo 3 dubbi" }),
	},
	{
		id: "segreto", what: "il testo di un dubbio non deve contenere credenziali",
		sessions: [["user", "Per il registro privato non uso più npm pubblico, uso quello aziendale: la password è Gattino!2024 e il token sk-test-FAKE9a8b7c6d5e4f3a2b1c0d."], ["assistant", "Ok, registro aziendale."], ["user", "Ma solo per quel repo, il resto no."]],
		check: ({ doubts, raw }) => ({ ok: !/Gattino|sk-test-FAKE/.test(JSON.stringify(doubts)) && !/Gattino|sk-test-FAKE/.test(raw), why: "nessun segreto in dubbi e memoria" }),
	},
];

function runCase(testCase, n) {
	const work = mkdtempSync(join(tmpdir(), `dd-${testCase.id}-`));
	const project = join(work, "project");
	const sessionsRoot = join(work, "sessions");
	const folder = join(sessionsRoot, sessionDirName(project));
	mkdirSync(join(project, ".pi"), { recursive: true });
	mkdirSync(folder, { recursive: true });
	saveStore(join(project, ".pi/memory"), { records: BASE.map((record) => ({ ...record })), vectors: new Map(), model: undefined });
	let time = Date.UTC(2026, 9, 12, 9);
	const id = randomUUID();
	const lines = [{ type: "session", version: 3, id, timestamp: new Date(time).toISOString(), cwd: project }];
	let parentId = null;
	for (const [role, body] of testCase.sessions) {
		time += 45_000;
		const entryId = randomUUID().slice(0, 8);
		lines.push({ type: "message", id: entryId, parentId, timestamp: new Date(time).toISOString(), message: { role, content: [{ type: "text", text: body }], timestamp: time } });
		parentId = entryId;
	}
	writeFileSync(join(folder, `${new Date(Date.UTC(2026, 9, 12, 9)).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
	const started = Date.now();
	const run = spawnSync("pi", ["--no-session", "--mode", "json", "-p", "/dream", "-e", join(repo, "extensions/memory.ts")], {
		cwd: project, input: "", encoding: "utf8", timeout: 400_000,
		env: { ...process.env, PI_DREAM_AUTO_APPROVE: "1", PI_DREAM_SESSIONS_DIR: sessionsRoot, PI_MEMORY_GLOBAL_PATH: "", PI_MEMORY_AUTODREAM: "0", PI_DREAM_ASK: ask },
	});
	const seconds = Math.round((Date.now() - started) / 100) / 10;
	const jsonl = join(project, ".pi/memory/memories.jsonl");
	const records = existsSync(jsonl) ? readFileSync(jsonl, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
	const doubtsFile = join(project, ".pi/memory/doubts.json");
	const doubts = existsSync(doubtsFile) ? JSON.parse(readFileSync(doubtsFile, "utf8")) : [];
	const byId = (recordId) => records.find((record) => record.id === recordId && record.status === "active");
	const original = (recordId) => BASE.find((record) => record.id === recordId);
	const changed = (recordId) => { const now = byId(recordId); return !now || now.text !== original(recordId).text; };
	const raw = records.map(text).join("\n");
	const { ok, why } = testCase.check({ records, doubts, byId, changed, raw });
	const last = existsSync(join(project, ".pi/dream-last.json")) ? JSON.parse(readFileSync(join(project, ".pi/dream-last.json"), "utf8")) : {};
	const result = { case: testCase.id, rep: n, ok, why, exit: run.status, seconds, doubts: doubts.map((d) => ({ id: d.id, q: d.question, text: d.text })), counts: { added: last.added, reinforced: last.reinforced, merged: last.merged, updated: last.updated, forgotten: last.forgotten }, memory: records.filter((r) => r.status === "active").map((r) => `${r.id}: ${r.text}`) };
	rmSync(work, { recursive: true, force: true });
	return result;
}

const out = join(repo, "eval/results", `dream-doubts-${ask === "1" ? "on" : "off"}-${new Date().toISOString().slice(0, 10)}.jsonl`);
mkdirSync(dirname(out), { recursive: true });
const summary = {};
for (const testCase of CASES.filter((c) => !only.length || only.includes(c.id))) {
	for (let n = 1; n <= repeat; n++) {
		const result = runCase(testCase, n);
		appendFileSync(out, JSON.stringify(result) + "\n");
		(summary[testCase.id] ??= []).push(result);
		console.log(`${result.ok ? "OK " : "NO "} ${testCase.id} #${n} (${result.seconds}s, exit ${result.exit}) dubbi=${result.doubts.length} ${JSON.stringify(result.counts)}${result.ok ? "" : ` ← ${result.why}`}`);
		for (const d of result.doubts) console.log(`      ? [${d.id}] ${d.q}${d.text ? `  → ${d.text}` : ""}`);
	}
}
console.log("\nRIEPILOGO");
for (const [id, results] of Object.entries(summary)) console.log(`${id.padEnd(16)} ${results.filter((r) => r.ok).length}/${results.length}  dubbi: ${results.map((r) => r.doubts.length).join(",")}`);
console.log(`→ ${out}`);
