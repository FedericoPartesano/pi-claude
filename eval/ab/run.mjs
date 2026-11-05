// A/B of the savings levers on a scripted session: same prompts, arm A = Pi defaults (keepRecentTokens 20000, no archive),
// arm C = keepRecentTokens 5000 only (archive off, to tell the two levers apart),
// arm D = arm B with `richiama` on from the first request (PI_ARCHIVE_EARLY=1),
// arm E = arm B without automatic recall (PI_ARCHIVE_AUTO=0: tool only, to split the cost of the two parts),
// arm F = arm B without the `richiama` tool (the default since §17: automatic recall only; arms B, D, E set PI_ARCHIVE_TOOL=1, prefix never changes),
// arm B = levers (keepRecentTokens 5000 + `richiama` archive with automatic recall). Cost is the weighted usage of every
// request of the session (compaction summary included) from the session file; quality is five known-answer questions
// asked after the compaction. Usage: node eval/ab/run.mjs <A|B> <rep> [model]
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";

const [arm, rep = "1", model = "haiku", mode = "short"] = process.argv.slice(2);
const hard = mode === "hard";
const dump = mode === "dump";
const noid = mode === "noid";
const long = mode === "long" || hard || dump || noid;
if (!["A", "B", "C", "D", "E", "F"].includes(arm)) throw new Error("arm A, B, C, D, E or F");
const repo = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const cwd = `/tmp/ab-${mode}-${arm}-${rep}`;
mkdirSync(`${cwd}/.pi`, { recursive: true });
writeFileSync(`${cwd}/.pi/settings.json`, JSON.stringify({ compaction: { keepRecentTokens: noid ? 10000 : arm === "A" ? 20000 : 5000, ...(noid ? { reserveTokens: 150000 } : {}) } }));

const W = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 };
const cost = (u) => Object.entries(W).reduce((sum, [key, weight]) => sum + (u?.[key] ?? 0) * weight, 0);

const h = new PiHarness(cwd, model, `${cwd}/debug.log`, { persistSession: true, extraArgs: noid ? ["--approve"] : [], environment: arm === "B" ? { PI_ARCHIVE_TOOL: "1" } : arm === "D" ? { PI_ARCHIVE_TOOL: "1", PI_ARCHIVE_EARLY: "1" } : arm === "E" ? { PI_ARCHIVE_TOOL: "1", PI_ARCHIVE_AUTO: "0" } : arm === "F" ? {} : { PI_ARCHIVE: "0" } });
const send = (m) => new Promise((res) => { const id = `c${Math.random()}`; const l = (r) => { if (r.id === id) { h.process.listeners.delete(l); res(r); } }; h.process.listeners.add(l); h.process.send({ ...m, id }); });
const turns = [];
const ask = async (phase, prompt, expect) => {
	const t = await h.runTurn(prompt);
	const ok = expect ? t.answer.includes(expect) : undefined;
	turns.push({ phase, prompt: prompt.slice(0, 70), expect, ok, requests: t.requests, tools: t.tools, usage: t.usage, cost: cost(t.usage), seconds: t.seconds, errors: t.errors, answer: t.answer.slice(0, 160) });
	console.log(phase, ok ?? "", Math.round(cost(t.usage)), t.tools.join(","));
};

// Hard mode: eight random codes given once, only in the conversation: nothing on disk can give them back.
const hex = () => Math.random().toString(16).slice(2, 8).toUpperCase();
const labels = ["Zefiro", "Borea", "Austro", "Euro", "Maestrale", "Grecale", "Libeccio", "Scirocco", "Ponente", "Levante", "Tramontana", "Ostro", "Etesi", "Bora", "Garbino", "Favonio", "Aquilone", "Noto", "Meltemi", "Khamsin", "Harmattan", "Mistral", "Foehn", "Sirocco2", "Chinook", "Pampero", "Zonda", "SantaAna", "Bise", "Gregale"];
const facts = labels.map((name) => ({ name, code: `${hex()}-${hex()}` }));
// Dump mode: command outputs that exist only in the conversation (the files are deleted before the questions).
const logs = Array.from({ length: 12 }, (_, n) => ({ name: `b${String(n + 1).padStart(2, "0")}`, lines: Array.from({ length: 50 }, (_, l) => `L${l + 1} = ${hex()}`) }));
if (dump) {
	mkdirSync(`${cwd}/logs`, { recursive: true });
	for (const g of logs) {
		writeFileSync(`${cwd}/logs/${g.name}.txt`, g.lines.join("\n") + "\n");
		await ask("plant", `Esegui con bash: cat ${cwd}/logs/${g.name}.txt e rispondi solo 'ok'.`);
	}
}
// Noid mode: facts told in prose, asked later with other words and no identifier; reserveTokens 150000 forces >=5 compactions.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const num = (lo, hi) => String(lo + Math.floor(Math.random() * (hi - lo)));
const nf = noid ? [
	{ say: (v) => `Nel turno di notte il nastro trasportatore ha avuto ${v} anomalie`, ask: "Quante anomalie ha avuto il trasportatore durante le ore notturne?", val: num(11, 98) },
	{ say: (v) => `Il compressore della cella frigorifera consuma ${v} kilowatt a regime`, ask: "Quanta potenza assorbiva a regime l'impianto del freddo?", val: num(101, 990) },
	{ say: (v) => `La caldaia del reparto verniciatura è stata revisionata dal tecnico ${v}`, ask: "Quale tecnico aveva ispezionato la caldaia del reparto di verniciatura?", val: pick(["Brambilla", "Colombo", "Fumagalli", "Sala"]) },
	{ say: (v) => `Il serbatoio dell'acqua piovana contiene ${v} litri`, ask: "Quanti litri aveva la vasca di raccolta dell'acqua piovana?", val: num(1200, 9800) },
	{ say: (v) => `Il muletto elettrico numero tre ha percorso ${v} chilometri`, ask: "Quanta strada aveva fatto il carrello elevatore elettrico?", val: num(1500, 9900) },
	{ say: (v) => `Il fornitore del vetro temperato consegna ogni ${v} giorni`, ask: "Ogni quanti giorni arrivava la merce dal fornitore delle lastre di cristallo?", val: num(6, 29) },
	{ say: (v) => `L'ascensore del magazzino ha una portata massima di ${v} chilogrammi`, ask: "Che carico massimo reggeva il montacarichi dell'edificio di stoccaggio?", val: num(310, 990) },
	{ say: (v) => `Il sensore di umidità della serra segna ${v} per cento`, ask: "Che percentuale di umidità indicava lo strumento nella serra?", val: num(41, 95) },
	{ say: (v) => `La squadra di manutenzione notturna è composta da ${v} persone`, ask: "Di quante persone era fatto il gruppo che fa i lavori di riparazione di notte?", val: num(3, 19) },
	{ say: (v) => `Il lotto di bulloni respinto aveva il marchio ${v}`, ask: "Che marchio riportava la partita di viti scartata?", val: pick(["Ferrovia", "Cobalto", "Tramonto", "Quarzo"]) },
	{ say: (v) => `La pressa idraulica lavora a ${v} bar`, ask: "A quale pressione operava la macchina per stampare a olio?", val: num(110, 480) },
	{ say: (v) => `Il magazzino ricambi chiude alle ore ${v}`, ask: "A che ora serrava il deposito dei pezzi di scorta?", val: num(14, 22) },
] : [];
const noidFill = () => Array.from({ length: 14 }, () => `riga ${num(1000, 9999)}: lettura ${num(10, 99)} stato ok scarto ${num(0, 9)}`);
if (noid) {
	mkdirSync(`${cwd}/rapporti`, { recursive: true });
	for (const [i, f] of nf.entries()) {
		const lines = noidFill(); lines.splice(5 + (i % 7), 0, f.say(f.val));
		writeFileSync(`${cwd}/rapporti/r${i + 1}.txt`, lines.join("\n") + "\n");
		await ask("plant", `Esegui con bash: cat ${cwd}/rapporti/r${i + 1}.txt e rispondi solo 'ok'.`);
	}
}
else if (hard) for (let i = 0; i < facts.length; i += 3) await ask("plant", `Ricorda questi codici di progetto: ${facts.slice(i, i + 3).map((f) => `${f.name} = ${f.code}`).join("; ")}. Rispondi solo 'ok'.`);
else if (!noid) await ask("plant", "Ricorda: il codice segreto del progetto Zefiro è QX-7741-ALFA e la porta è 48213. Rispondi solo 'ok'.");
const early = ["extensions/archivio.ts", "pi-team/src/view/side-log.ts"];
const bulk = ["pi-ui/index.ts", "extensions/memory.ts", "extensions/memory-core.ts", "pi-memory/src/dashboard-tui.ts", "extensions/goal.ts", "pi-memory/src/recall.ts", "extensions/graph/graphify.ts", "pi-desk/renderer/src/render.ts", "pi-team/src/orchestrator.ts", "pi-team/index.ts", "pi-claude-code/src/provider.ts", "extensions/intent.ts", "extensions/graph/modal.ts", "extensions/vault.ts", "extensions/browser/session.ts", "pi-ui/src/panel.ts", "extensions/graph.ts", "extensions/loop.ts"];
const noidFiles = ["pi-ui/index.ts", "extensions/memory.ts", "extensions/memory-core.ts", "extensions/goal.ts", "extensions/intent.ts", "extensions/vault.ts", "pi-memory/src/dashboard-tui.ts", "extensions/graph/graphify.ts", "pi-desk/renderer/src/render.ts", "pi-team/src/orchestrator.ts", "pi-team/index.ts", "pi-claude-code/src/provider.ts", "extensions/archivio.ts", "extensions/lean-tools.ts", "extensions/test-monitor.ts", "pi-ui/src/status-bar.ts", "pi-memory/src/recall.ts", "pi-team/src/runner.ts", "pi-team/src/crm.ts", "extensions/caveman.ts", "pi-picker/index.ts", "extensions/bug.ts", "extensions/guards.ts", "extensions/loop.ts"].filter((f) => { try { statSync(`${repo}/${f}`); return true; } catch { return false; } });
const files = noid ? noidFiles : long ? [...early, ...bulk] : ["extensions/goal.ts", "extensions/memory.ts", "extensions/intent.ts", "extensions/vault.ts", ...early];
for (const f of files) await ask("read", `Leggi con il tool read il file ${repo}/${f} e rispondi solo 'letto'.`);
if (long && !noid) for (const f of ["pi-ui/src/status-bar.ts", "extensions/test-monitor.ts", "extensions/lean-tools.ts"]) await ask("work", `Leggi ${repo}/${f} con il tool read e dimmi in una frase cosa fa.`);
if (noid) {
	rmSync(`${cwd}/rapporti`, { recursive: true, force: true });
	for (const f of nf) await ask("post", f.ask + " Rispondi solo con il valore (senza unità).", f.val);
	// Ordinary prompts that need nothing from the past: any automatic recall attached to them is a wrong injection.
	for (const q of ["Scrivi in una riga cosa fa un algoritmo di ordinamento a bolle.", "Dammi tre consigli per scrivere buoni messaggi di commit.", "Qual è la differenza tra una promise e un callback in JavaScript?", "Spiegami in una frase cos'è un indice hash.", "Elenca due vantaggi dei test automatici.", "Come si inverte una stringa in Python? Una riga.", "Che cosa significa l'acronimo REST?", "Suggerisci un nome breve per una funzione che somma due numeri."]) await ask("neg", q);
} else if (dump) {
	rmSync(`${cwd}/logs`, { recursive: true, force: true });
	for (const g of logs.filter((_, i) => i % 2 === 1)) {
		const l = 5 + Math.floor(Math.random() * 40);
		await ask("post", `Nel file ${g.name}.txt che ti avevo fatto leggere con cat, quanto valeva L${l}? Rispondi solo con il valore.`, g.lines[l - 1].split(" = ")[1]);
	}
} else if (hard) for (const f of facts.filter((_, i) => i % 3 === 1)) await ask("post", `Che codice ti avevo dato per il progetto ${f.name}? Rispondi solo con il codice.`, f.code);
else {
await ask("post", "Che numero di porta ti avevo dato all'inizio per Zefiro? Rispondi solo con il numero.", "48213");
await ask("post", "E il codice segreto di Zefiro? Rispondi solo con il codice.", "QX-7741-ALFA");
await ask("post", "In extensions/archivio.ts, qual è il valore di default di PI_ARCHIVE_MIN? Rispondi solo con il numero.", "4");
await ask("post", "In pi-team/src/view/side-log.ts, quanto vale STALL_SECONDS? Rispondi solo con il numero.", "45");
await ask("post", "In pi-team/src/view/side-log.ts, quanto vale LINGER_MS? Rispondi solo con il numero.", "15");
}
h.close();

// Whole session from the file Pi wrote: every assistant message plus the compaction summary request.
const dir = join(homedir(), ".pi/agent/sessions", `--${cwd.replace(/^\//, "").replace(/[/]/g, "-")}--`);
const file = readdirSync(dir).map((n) => join(dir, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
let total = 0, compaction = 0, requests = 0;
for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
	const e = JSON.parse(line);
	if (e.type === "message" && e.message?.role === "assistant") { total += cost(e.message.usage); requests++; }
	if (e.type === "compaction") { compaction += cost(e.usage); total += cost(e.usage); }
}
const post = turns.filter((t) => t.phase === "post");
const compactions = readFileSync(file, "utf8").split("\n").filter((l) => l.includes('"type":"compaction"')).length;
const result = { arm, rep, model, total: Math.round(total), compaction: Math.round(compaction), requests, compactions, postCost: Math.round(post.reduce((s, t) => s + t.cost, 0)), correct: post.filter((t) => t.ok).length, asked: post.length, turns };
writeFileSync(`${repo}/eval/ab/result-${mode}-${arm}-${rep}.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, turns: undefined }));
