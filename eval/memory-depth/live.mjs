#!/usr/bin/env node
/**
 * Live memory-depth eval: real Pi + Claude Code, real recall. node eval/memory-depth/live.mjs [--old <memory.ts>]
 * Each scenario: a project with a memory (a chain of linked memories, a superseded fact, or nothing relevant) among 100
 * filler memories, one question, and what the answer must (and must not) say. The question never shares words with the
 * memory holding the answer: only following the graph gets there. With --old, the same scenarios with another
 * memory.ts (e.g. main's) for comparison. Results in eval/results/memory-depth-<date>.json.
 *
 * --filler N (N > 100): a realistic store instead — N memories of the bench corpus (24 domains, links, two years) plus
 * --corpus-chains K (with --filler): the scenarios become the first K chains planted in that corpus (questions that share
 * words only with the first memory; the answer is the third), each judged on the fact it ends with.
 *
 * near-tie decoys for every chain (another export, another portal's login, another file layout), with real e5 vectors
 * computed once and copied into each scenario. This is where the deep cues must pick the right chain among many.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const oldAt = process.argv.indexOf("--old");
const variants = [{ name: "new", memory: join(repo, "extensions/memory.ts") }, ...(oldAt !== -1 ? [{ name: "old", memory: resolve(process.argv[oldAt + 1]) }] : [])];
const bridge = join(repo, "pi-claude-code/index.ts");

const base = { pinned: false, confirmations: 2, created: "2026-09-01", last: "2026-10-01", status: "active" };
const fillerArg = process.argv.indexOf("--filler");
const fillerSize = fillerArg !== -1 ? Number(process.argv[fillerArg + 1]) : 100;
const DECOYS = [
	["L'export degli ordini usa CsvWriter (src/export/csv.ts)", ["csv.ts", "export ordini"]],
	["CsvWriter scrive i file sul bucket S3 exports", ["csv.ts", "bucket exports"]],
	["L'export dei listini è lento con file grandi per le query N+1 su PostgreSQL", ["export listini"]],
	["La coda BullMQ mail ha concorrenza 5", ["coda mail"]],
	["Il portale ordini autentica con il provider OIDC tenant-beta", ["portale ordini", "tenant-beta"]],
	["Gli utenti del portale resi rifanno l'accesso dopo ogni cambio password", ["portale resi"]],
	["tenant-beta emette refresh token validi 30 giorni", ["tenant-beta"]],
	["Il tracciato del file degli ordini è prodotto dal job orders-export", ["tracciato ordini", "orders-export"]],
	["Le modifiche al tracciato fatture vanno validate con lo schema XSD", ["tracciato fatture"]],
	["L'output di orders-export viene caricato su SFTP del corriere", ["orders-export", "sftp corriere"]],
].map(([text, entities], i) => ({ ...base, id: `d${i}`, type: "fatto", text, entities }));
const filler = fillerSize > 100 ? [] : Array.from({ length: 100 }, (_, i) => ({ ...base, id: `f${i}`, type: "fatto", text: `Il servizio ${["clienti", "ordini", "listini", "magazzino", "resi"][i % 5]}${i} legge i dati da PostgreSQL e li espone via API REST`, entities: [`servizio${i}`] }));

const SCENARIOS = [
	{
		name: "chain: export -> queue -> RAM",
		question: "l'export delle fatture è lento con file grandi: posso parallelizzarlo di più? rispondi in due righe senza leggere il codice",
		memories: [
			{ id: "r1", type: "fatto", text: "L'export delle fatture usa ReportBuilder (src/report/builder.ts)", links: ["r2"], entities: ["builder.ts", "export fatture"] },
			{ id: "r2", type: "fatto", text: "ReportBuilder accoda i lavori sulla coda BullMQ reports", links: ["r3"], entities: ["reports", "builder.ts"] },
			{ id: "r3", type: "decisione", text: "La coda reports deve restare a concorrenza 1: il pod ha 512MB e con piu worker andava in OOM", entities: ["reports"] },
		],
		must: /512|OOM|concorrenza\s*1|memoria del pod/i,
	},
	{
		name: "chain: login -> tenant -> policy",
		question: "perché gli utenti del portale listini devono rifare l'accesso così spesso? rispondi in una riga senza leggere il codice",
		memories: [
			{ id: "r1", type: "fatto", text: "Il portale listini autentica con il provider OIDC tenant-acme", links: ["r2"], entities: ["portale listini", "tenant-acme"] },
			{ id: "r2", type: "fatto", text: "tenant-acme emette i token con la durata scritta in auth-policy.json", links: ["r3"], entities: ["tenant-acme", "auth-policy.json"] },
			{ id: "r3", type: "decisione", text: "auth-policy.json fissa la scadenza a 15 minuti per un requisito di sicurezza del cliente", entities: ["auth-policy.json"] },
		],
		must: /15\s*minuti|requisito/i,
	},
	{
		name: "chain: layout -> job -> customer",
		question: "devo cambiare il tracciato del file delle spedizioni: c'è qualcuno da sentire prima? rispondi in una riga",
		memories: [
			{ id: "r1", type: "fatto", text: "Il tracciato del file delle spedizioni è prodotto dal job notturno nightly-ship", links: ["r2"], entities: ["tracciato spedizioni", "nightly-ship"] },
			{ id: "r2", type: "fatto", text: "L'output di nightly-ship viene letto dal gestionale ERP del cliente", links: ["r3"], entities: ["nightly-ship", "erp cliente"] },
			{ id: "r3", type: "decisione", text: "Le modifiche che toccano l'ERP del cliente vanno concordate con il referente Bianchi via ticket MC", entities: ["erp cliente"] },
		],
		must: /Bianchi|ticket|MC\b/i,
	},
	{
		name: "superseded fact",
		question: "in che formato invio le fatture al portale del fornitore? una parola",
		memories: [
			{ id: "r1", type: "fatto", text: "Le fatture vanno al portale del fornitore in formato XML", status: "superseded", reason: "superato", last: "2025-01-10", entities: ["portale fornitore"] },
			{ id: "r2", type: "fatto", text: "Le fatture vanno al portale del fornitore in formato JSON (l'XML è dismesso)", entities: ["portale fornitore"] },
		],
		must: /JSON/i,
		mustNot: /^\W*XML\W*$/i,
	},
	{ name: "unrelated request", question: "scrivi un haiku sul mare d'inverno", memories: [], must: /./, noRecall: true },
	{ name: "small talk", question: "ok", memories: [], must: /./, noRecall: true },
];

const chainsArg = process.argv.indexOf("--corpus-chains");
const corpusChains = chainsArg !== -1 ? Number(process.argv[chainsArg + 1]) : 0;
// The fact each corpus chain template ends with (test/corpus.ts CHAIN_TEMPLATES, in order).
const CHAIN_FACTS = [/512|OOM|concorrenza\s*1/i, /15\s*minuti|requisito di sicurezza/i, /Bianchi|ticket\s*MC/i, /300\s*secondi|backup/i];

// A big store: corpus memories renamed f… (no clash with the scenarios' r1–r3), decoys, e5 vectors computed once.
let baseStore;
let embedder;
let fill;
if (fillerSize > 100) {
	const { buildCorpus } = await import(join(repo, "pi-memory/test/corpus.ts"));
	const { BackgroundEmbedder, MODELS } = await import(join(repo, "pi-memory/src/embed.ts"));
	({ fillVectors: fill } = await import(join(repo, "pi-memory/src/engine.ts")));
	const rename = (id) => `f${id}`;
	const built = buildCorpus(fillerSize);
	if (corpusChains > 0) {
		SCENARIOS.length = 0;
		built.chains.slice(0, corpusChains).forEach((chain, i) => SCENARIOS.push({ name: `corpus ${i} (${chain.via})`, question: `${chain.query} rispondi in una riga senza leggere il codice`, memories: [], must: CHAIN_FACTS[i % 4] }));
	}
	const corpus = built.records.map((record) => ({ ...record, id: rename(record.id), ...(record.links ? { links: record.links.map(rename) } : {}) }));
	baseStore = mkdtempSync(join(tmpdir(), "memdepth-base-"));
	writeFileSync(join(baseStore, "memories.jsonl"), [...corpus, ...DECOYS].map((record) => JSON.stringify(record)).join("\n") + "\n");
	embedder = new BackgroundEmbedder(MODELS.e5);
	if (!(await embedder.start())) throw new Error("e5 non caricato");
	const started = Date.now();
	const count = await fill(baseStore, embedder);
	console.log(`archivio di base: ${corpus.length + DECOYS.length} ricordi, ${count} vettori e5 in ${Math.round((Date.now() - started) / 1000)}s`);
}

const run = async (variant, scenario) => {
	const dir = mkdtempSync(join(tmpdir(), "memdepth-"));
	mkdirSync(join(dir, ".pi/memory"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: dir });
	const records = [...scenario.memories.map((memory) => ({ ...base, ...memory })), ...filler];
	if (baseStore) {
		for (const name of readdirSync(baseStore)) copyFileSync(join(baseStore, name), join(dir, ".pi/memory", name));
		const existing = readFileSync(join(dir, ".pi/memory/memories.jsonl"), "utf8");
		writeFileSync(join(dir, ".pi/memory/memories.jsonl"), existing + (records.length ? records.map((record) => JSON.stringify(record)).join("\n") + "\n" : ""));
		await fill(join(dir, ".pi/memory"), embedder);
	} else writeFileSync(join(dir, ".pi/memory/memories.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
	const started = Date.now();
	let answer = "";
	try {
		answer = execFileSync("pi", ["--no-session", "--no-extensions", "-e", bridge, "-e", variant.memory, "-p", scenario.question], { cwd: dir, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, PI_OFFLINE: "1", PI_MEMORY_RECALL_LOG: "1" } }).trim();
	} catch (error) {
		answer = `ERROR ${String(error.message).slice(0, 200)}`;
	}
	const log = join(dir, ".pi/memory/recall-log.jsonl");
	const injected = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).pop()?.injected ?? [] : [];
	const ok = scenario.must.test(answer) && !(scenario.mustNot?.test(answer)) && (!scenario.noRecall || injected.length === 0);
	return { scenario: scenario.name, variant: variant.name, ok, injected, seconds: Math.round((Date.now() - started) / 1000), answer: answer.slice(0, 400) };
};

const results = [];
for (const scenario of SCENARIOS) {
	for (const variant of variants) {
		const result = await run(variant, scenario);
		results.push(result);
		console.log(`${result.ok ? "✓" : "✗"} ${variant.name.padEnd(3)} ${scenario.name.padEnd(34)} injected [${result.injected.join(",")}] ${result.seconds}s :: ${result.answer.replace(/\s+/g, " ").slice(0, 110)}`);
	}
}
const out = join(repo, "eval/results", `memory-depth-${new Date().toISOString().slice(0, 10)}${fillerSize > 100 ? `-${fillerSize}` : ""}${corpusChains ? `-chains${corpusChains}` : ""}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(results, null, 2));
if (fillerSize > 100) console.log(`archivio: ${fillerSize} ricordi + ${DECOYS.length} esche${corpusChains ? ` · ${corpusChains} catene del corpus` : ""}`);
for (const variant of variants) console.log(`${variant.name}: ${results.filter((r) => r.variant === variant.name && r.ok).length}/${SCENARIOS.length}`);
