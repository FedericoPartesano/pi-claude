/** Synthetic archive for the scale evaluation: 1.000 memories on 30 topics with 20 buried target memories. */
import type { Embedder } from "../src/embed.ts";
import { RecallIndex, recall } from "../src/recall.ts";
import { embedText, type MemoryRecord } from "../src/store.ts";
import { extractEntities } from "../src/entities.ts";

export interface Target {
	text: string;
	type: string;
	/** Keywords as /dream would propose them (the model is asked for 1-5 per memory). */
	concepts: string[];
	/** Query sharing some words with the target (lexical-friendly). */
	lexical: string;
	/** Paraphrase with almost no shared words (needs semantics). */
	paraphrase: string;
}

export const TARGETS: Target[] = [
	{ type: "correzione", text: "Gli importi si salvano sempre in centesimi interi, mai in float.", concepts: ["importi", "prezzi", "costi", "float"], lexical: "salvo l'importo di una fattura come float?", paraphrase: "come rappresento il costo di un articolo nel database?" },
	{ type: "fatto", text: "Il database di produzione è PostgreSQL 15 con estensione JSONB.", concepts: ["postgresql", "database", "dati", "produzione"], lexical: "che database di produzione usiamo?", paraphrase: "dove vengono persistiti i dati in esercizio?" },
	{ type: "preferenza", text: "I messaggi d'errore mostrati all'utente sono sempre in italiano.", concepts: ["messaggi d'errore", "italiano", "localizzazione"], lexical: "scrivi il messaggio d'errore per il login fallito", paraphrase: "aggiungi il testo da mostrare quando la password è sbagliata" },
	{ type: "preferenza", text: "Niente commit né push senza richiesta esplicita dell'utente.", concepts: ["commit", "push", "git", "repository"], lexical: "fai il commit delle modifiche", paraphrase: "salva il lavoro nel repository e pubblicalo" },
	{ type: "fatto", text: "I test di integrazione girano con docker compose in docker/compose.test.yml.", concepts: ["test di integrazione", "docker compose", "test end to end"], lexical: "come lancio i test di integrazione?", paraphrase: "voglio eseguire le verifiche end to end in locale" },
	{ type: "decisione", text: "Le migrazioni vanno in db/migrations con prefisso numerico a quattro cifre.", concepts: ["migrazioni", "schema", "database"], lexical: "crea una migrazione per la nuova colonna", paraphrase: "devo cambiare lo schema della tabella ordini" },
	{ type: "fatto", text: "La sessione di login scade dopo 30 minuti di inattività (AuthService.ts).", concepts: ["sessione", "login", "scadenza", "autenticazione"], lexical: "quanto dura la sessione di login?", paraphrase: "dopo quanto tempo l'utente viene disconnesso se non fa nulla?" },
	{ type: "decisione", text: "Le date si salvano in UTC formato ISO 8601 e si convertono solo nella UI.", concepts: ["date", "fusi orari", "utc", "orari"], lexical: "come gestisco le date e i fusi orari?", paraphrase: "in che formato memorizzo l'orario di scadenza?" },
	{ type: "correzione", text: "Il logger strutturato è in src/lib/logger.ts: vietato usare console.log.", concepts: ["logger", "logging", "debug", "console.log"], lexical: "aggiungi un log nell'handler", paraphrase: "voglio stampare un messaggio di debug" },
	{ type: "decisione", text: "L'API pubblica è versionata sul path /api/v2; la v1 è deprecata.", concepts: ["api", "rest", "endpoint", "versionamento"], lexical: "aggiungo un endpoint all'api", paraphrase: "nuova rotta REST per l'anagrafica clienti" },
	{ type: "preferenza", text: "Il package manager del progetto è pnpm, non npm né yarn.", concepts: ["pnpm", "package manager", "dipendenze", "librerie"], lexical: "che package manager usiamo?", paraphrase: "aggiungi una libreria esterna al progetto" },
	{ type: "preferenza", text: "I componenti React sono funzioni con hook, niente class component.", concepts: ["react", "componenti", "hook", "interfaccia"], lexical: "scrivi un componente React per la lista", paraphrase: "crea il widget che mostra l'elenco degli ordini" },
	{ type: "fatto", text: "La cache Redis del catalogo ha TTL di 5 minuti (src/cache/catalog.ts).", concepts: ["cache", "redis", "ttl", "catalogo"], lexical: "quanto vive la cache del catalogo?", paraphrase: "per quanto tempo restano in memoria veloce i prodotti?" },
	{ type: "decisione", text: "Il deploy avviene via GitHub Actions dal branch release/*, mai a mano.", concepts: ["deploy", "rilascio", "github actions", "pubblicazione"], lexical: "come faccio il deploy in produzione?", paraphrase: "pubblica la nuova versione online" },
	{ type: "fatto", text: "I file CSV di import usano il punto e virgola e la codifica Windows-1252.", concepts: ["csv", "import", "codifica", "esportazione"], lexical: "leggi il file CSV di import", paraphrase: "carico l'esportazione che arriva dal gestionale" },
	{ type: "fatto", text: "Le email transazionali passano da SendGrid, mittente no-reply@acme.example.", concepts: ["email", "sendgrid", "notifiche", "posta elettronica"], lexical: "invia l'email di conferma ordine", paraphrase: "avvisa il cliente via posta elettronica" },
	{ type: "fatto", text: "Il rate limit dell'API è 100 richieste al minuto per chiave (rateLimiter.ts).", concepts: ["rate limit", "api", "richieste", "limite"], lexical: "qual è il limite di richieste dell'API?", paraphrase: "quante chiamate al minuto può fare un client?" },
	{ type: "decisione", text: "Gli id utente sono UUID v7, non interi progressivi.", concepts: ["uuid", "id utente", "chiave primaria", "account"], lexical: "genera l'id per il nuovo utente", paraphrase: "che tipo di chiave primaria ha la tabella degli account?" },
	{ type: "preferenza", text: "Formattazione: tab per l'indentazione e virgolette doppie.", concepts: ["formattazione", "indentazione", "stile del codice", "tab"], lexical: "formatta il file con l'indentazione a spazi", paraphrase: "come devo allineare il codice che scrivo?" },
	{ type: "decisione", text: "I feature flag stanno in config/flags.json e si leggono con isEnabled().", concepts: ["feature flag", "flag", "funzionalità", "configurazione"], lexical: "attiva la nuova funzione dietro un flag", paraphrase: "come abilito una funzionalità solo per alcuni utenti?" },
];

export const UNRELATED: string[] = [
	"qual è la capitale della Francia?", "che tempo farà domani a Milano?", "scrivi una poesia sul mare", "quanto fa 17 per 23?", "traduci buongiorno in inglese",
	"suggeriscimi una ricetta per la carbonara", "chi ha vinto i mondiali del 2006?", "spiegami la teoria della relatività", "consigliami un film di fantascienza", "come si coltiva il basilico?",
	"raccontami una barzelletta", "quanti abitanti ha Tokyo?", "cos'è la fotosintesi?", "dammi un consiglio per dormire meglio", "chi ha dipinto la Gioconda?",
	"ciao, come stai?", "ok grazie", "come si inverte una stringa in Python?", "spiega la differenza tra let e const", "cos'è la complessità computazionale di un algoritmo di ordinamento?",
	// Near-domain unrelated: questions about data and explanations of code, no change requested (the first one was a measured false positive).
	"Quanti libri del genere giallo ci sono in data/books.csv? Rispondi solo con il numero", "Quante righe ha il file data/clienti.csv?", "Spiega cosa fa la funzione calcolaTotale in src/utils.ts, senza modificarla", "Che differenza c'è tra un database relazionale e uno a documenti?", "Cosa significa l'errore TypeError: undefined is not a function? Non toccare il codice",
];

const TOPICS = "fatturazione magazzino ordini spedizioni pagamenti catalogo report notifiche ricerca permessi esportazione audit backup monitoraggio mobile frontend scheduler code resi fornitori promozioni contratti inventario fidelity assistenza analytics archivio workflow integrazioni dashboard".split(" ");
const THINGS = ["la funzione di calcolo", "il job notturno", "la tabella di appoggio", "il servizio interno", "la schermata di riepilogo", "il parser dei dati", "il controllo dei duplicati", "l'esportazione periodica", "la coda dei messaggi", "il modulo di validazione", "la procedura di riconciliazione", "il widget di stato"];
const FACTS = ["è gestito da un solo servizio", "usa un timeout configurabile", "è coperto da test unitari", "viene eseguito alle 02:00", "scrive un record di audit", "ha una pagina dedicata nell'interfaccia", "è stato riscritto lo scorso trimestre", "dipende dal modulo anagrafiche", "richiede il ruolo amministratore", "ha una documentazione in wiki", "produce un file temporaneo", "è lento con molti record"];

function random(seed: number) {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

export function buildArchive(size = 1000): MemoryRecord[] {
	const next = random(42);
	const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
	const records: MemoryRecord[] = [];
	const make = (text: string, type: string, confirmations: number, day: number): MemoryRecord => ({
		id: `r${records.length + 1}`, type, text, pinned: false, confirmations, created: "2026-01-01", last: `2026-${String(1 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`, status: "active", entities: extractEntities(text),
	});
	TARGETS.forEach((target, i) => {
		const record = make(target.text, target.type, 1 + (i % 4), 200 + i);
		record.entities = [...new Set([...record.entities, ...target.concepts])];
		records.push(record);
	});
	while (records.length < size) {
		const topic = pick(TOPICS);
		const type = pick(["fatto", "decisione", "fatto", "preferenza"]);
		records.push(make(`Nel modulo ${topic} ${pick(THINGS)} ${pick(FACTS)} (nota ${records.length}).`, type, 1 + Math.floor(next() * 3), Math.floor(next() * 270)));
	}
	// Shuffle deterministically so targets are buried.
	for (let i = records.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[records[i], records[j]] = [records[j], records[i]];
	}
	return records.map((record, i) => ({ ...record, id: `r${i + 1}` }));
}

export interface Metrics {
	recallLexical: number;
	recallParaphrase: number;
	recallAll: number;
	falsePositives: number;
	falsePositiveQueries: string[];
	falsePositiveRate: number;
	meanTokensRelevant: number;
	maxTokens: number;
	recallMsMean: number;
	recallMsMax: number;
}

/** Runs the scale evaluation with a given embedder and threshold. `index`/`vectors` can be reused across thresholds. */
export async function evaluate(embedder: Embedder | undefined, threshold: number, prepared?: { records: MemoryRecord[]; vectors: Map<string, Float32Array>; queryVectors: Map<string, Float32Array> }): Promise<Metrics> {
	const records = prepared?.records ?? buildArchive();
	const vectors = prepared?.vectors ?? new Map<string, Float32Array>();
	if (!prepared && embedder) (await embedder.embed(records.map(embedText), "passage")).forEach((vector, i) => vectors.set(records[i].id, vector));
	const queries = [...TARGETS.map((t, i) => ({ q: t.lexical, target: i, kind: "lexical" })), ...TARGETS.map((t, i) => ({ q: t.paraphrase, target: i, kind: "paraphrase" })), ...UNRELATED.map((q) => ({ q, target: -1, kind: "unrelated" }))];
	const queryVectors = prepared?.queryVectors ?? new Map<string, Float32Array>();
	if (!prepared && embedder) (await embedder.embed(queries.map((query) => query.q), "query")).forEach((vector, i) => queryVectors.set(queries[i].q, vector));
	const index = new RecallIndex(records);
	const idOfTarget = (i: number) => records.find((record) => record.text === TARGETS[i].text)!.id;
	const hitsBy = { lexical: 0, paraphrase: 0 };
	let falsePositives = 0;
	const falsePositiveQueries: string[] = [];
	let tokens = 0;
	let relevantRuns = 0;
	let maxTokens = 0;
	const times: number[] = [];
	for (const query of queries) {
		const started = performance.now();
		const { hits } = recall(index, query.q, { today: "2026-10-06", vectors, queryVector: queryVectors.get(query.q), semFloor: embedder?.semFloor, semSpan: embedder?.semSpan, threshold });
		times.push(performance.now() - started);
		const chars = hits.reduce((sum, hit) => sum + hit.record.text.length + 12, 44);
		const used = hits.length === 0 ? 0 : Math.min(chars, 1080) / 3.6;
		maxTokens = Math.max(maxTokens, used);
		if (query.kind === "unrelated") {
			if (hits.length > 0) {
				falsePositives++;
				falsePositiveQueries.push(`${query.q} -> ${hits.map((hit) => `${hit.record.text.slice(0, 40)} (${hit.score.toFixed(2)})`).join(" | ")}`);
			}
		} else {
			relevantRuns++;
			tokens += used;
			if (hits.some((hit) => hit.record.id === idOfTarget(query.target))) hitsBy[query.kind as "lexical" | "paraphrase"]++;
		}
	}
	const n = TARGETS.length;
	return {
		recallLexical: hitsBy.lexical / n,
		recallParaphrase: hitsBy.paraphrase / n,
		recallAll: (hitsBy.lexical + hitsBy.paraphrase) / (2 * n),
		falsePositives,
		falsePositiveQueries,
		falsePositiveRate: falsePositives / UNRELATED.length,
		meanTokensRelevant: tokens / relevantRuns,
		maxTokens,
		recallMsMean: times.reduce((a, b) => a + b, 0) / times.length,
		recallMsMax: Math.max(...times),
	};
}
