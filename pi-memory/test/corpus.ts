/**
 * Deep-memory corpus at any scale (1k → 100k+): filler memories in 24 domains, planted 3-memory chains (the query
 * matches only the first; the answer is two links away), superseded facts and two years of timestamps. Deterministic.
 */
import type { MemoryRecord } from "../src/store.ts";

/** Seeded PRNG (mulberry32): the same corpus for the same seed. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const DOMAINS = ["fatture", "ordini", "magazzino", "spedizioni", "clienti", "fornitori", "listini", "pagamenti", "resi", "promozioni", "catalogo", "utenti", "permessi", "notifiche", "report", "audit", "import", "export", "sincronizzazione", "ricerca", "dashboard", "contratti", "scadenze", "turni"];
const KINDS = ["service", "controller", "repository", "worker", "client", "mapper", "validator", "scheduler"];
const STORES = ["PostgreSQL", "Redis", "MongoDB", "S3", "Elasticsearch", "SQL Server"];
const VERBS = ["legge", "scrive", "aggiorna", "valida", "sincronizza", "archivia", "notifica", "calcola"];
const ISSUES = ["è lento con molti record", "va in timeout di notte", "duplica le righe", "perde gli accenti", "blocca la UI", "consuma troppa RAM", "fallisce dopo il deploy", "non rispetta i permessi"];

const pick = <T>(random: () => number, list: T[]) => list[Math.floor(random() * list.length)];
const camel = (domain: string, kind: string) => `${domain}${kind[0].toUpperCase()}${kind.slice(1)}`;
const day = (random: () => number, start = Date.parse("2024-10-01"), span = 730) => new Date(start + Math.floor(random() * span) * 86_400_000).toISOString().slice(0, 10);

export interface Chain {
	/** The question: shares words only with the first memory of the chain. */
	query: string;
	ids: [string, string, string];
	/** linked = explicit links between the three; entity = only a shared entity connects them. */
	via: "linked" | "entity";
}

export interface Supersede {
	query: string;
	oldId: string;
	newId: string;
}

export interface Corpus {
	records: MemoryRecord[];
	chains: Chain[];
	supersedes: Supersede[];
	/** Requests unrelated to every memory: nothing should be recalled. */
	unrelated: string[];
}

/** Planted chains: the reason behind a behaviour sits two steps away from what the user asks about. */
const CHAIN_TEMPLATES = [
	(d: string, n: number) => ({
		q: `perché l'esportazione delle ${d} ${n} è così lenta con file grandi?`,
		a: `L'esportazione delle ${d} ${n} passa dal generatore ReportBuilder${n} (src/report/builder${n}.ts).`,
		b: `ReportBuilder${n} accoda i lavori sulla coda BullMQ reports-${n}.`,
		c: `La coda reports-${n} ha concorrenza 1: il pod ha solo 512MB e con più worker andava in OOM.`,
		e: [`builder${n}.ts`, `reports-${n}`],
	}),
	(d: string, n: number) => ({
		q: `come mai il login dei ${d} ${n} a volte chiede di nuovo la password?`,
		a: `Il login dei ${d} ${n} usa il provider OIDC tenant-${n}.`,
		b: `Il tenant-${n} emette token con durata configurata in auth-policy-${n}.json.`,
		c: `auth-policy-${n}.json fissa la scadenza a 15 minuti per un requisito di sicurezza del cliente.`,
		e: [`tenant-${n}`, `auth-policy-${n}.json`],
	}),
	(d: string, n: number) => ({
		q: `chi devo avvisare prima di cambiare il tracciato delle ${d} ${n}?`,
		a: `Il tracciato delle ${d} ${n} è prodotto dal job nightly-${n}.`,
		b: `L'output di nightly-${n} è letto dal sistema esterno ERP-${n} del cliente.`,
		c: `Le modifiche che toccano ERP-${n} vanno concordate con il referente Bianchi via ticket MC.`,
		e: [`nightly-${n}`, `ERP-${n}`],
	}),
	(d: string, n: number) => ({
		q: `posso alzare il timeout della sincronizzazione delle ${d} ${n}?`,
		a: `La sincronizzazione delle ${d} ${n} gira nel worker sync-${n} (src/sync/worker${n}.ts).`,
		b: `sync-${n} è eseguito da un cron Kubernetes con activeDeadline in k8s/cron-${n}.yaml.`,
		c: `cron-${n}.yaml non va oltre 300 secondi: oltre si sovrappone al backup delle 2:00.`,
		e: [`sync-${n}`, `cron-${n}.yaml`],
	}),
];

export function buildCorpus(size: number, options: { seed?: number; chains?: number } = {}): Corpus {
	const random = rng(options.seed ?? 7);
	const records: MemoryRecord[] = [];
	let counter = 0;
	const make = (text: string, entities: string[], extra: Partial<MemoryRecord> = {}): MemoryRecord => {
		const created = day(random);
		const record: MemoryRecord = { id: `r${++counter}`, type: pick(random, ["fatto", "decisione", "preferenza", "episodio", "correzione"]), text, pinned: false, confirmations: 1 + Math.floor(random() * 3), created, last: created, status: "active", entities, ...extra };
		records.push(record);
		return record;
	};
	const chains: Chain[] = [];
	const chainCount = options.chains ?? 40;
	for (let i = 0; i < chainCount; i++) {
		const n = 100 + i;
		const d = DOMAINS[i % DOMAINS.length];
		const t = CHAIN_TEMPLATES[i % CHAIN_TEMPLATES.length](d, n);
		// Crossed with the template (i % 4): every template appears both linked and entity-only.
		const via: Chain["via"] = Math.floor(i / 4) % 2 === 0 ? "linked" : "entity";
		// Entity chains: A–B share e[0], B–C share e[1] (no explicit link). Linked chains: explicit links as well.
		const a = make(t.a, [d, t.e[0]]);
		const b = make(t.b, [t.e[0], t.e[1]]);
		const c = make(t.c, [t.e[1]], { type: "decisione" });
		if (via === "linked") {
			a.links = [b.id];
			b.links = [c.id];
		}
		chains.push({ query: t.q, ids: [a.id, b.id, c.id], via });
	}
	const supersedes: Supersede[] = [];
	for (let i = 0; i < 20; i++) {
		const d = DOMAINS[(i * 5) % DOMAINS.length];
		const n = 500 + i;
		const old = make(`Le ${d} ${n} si esportano in formato XML verso il portale.`, [d, `portale-${n}`], { status: "superseded", reason: "superato", last: "2025-01-10" });
		const fresh = make(`Le ${d} ${n} si esportano in formato JSON verso il portale (l'XML è dismesso).`, [d, `portale-${n}`], { last: "2026-06-01" });
		supersedes.push({ query: `in che formato esporto le ${d} ${n} verso il portale?`, oldId: old.id, newId: fresh.id });
	}
	// Filler: plausible project memories, with links inside a domain (a graph, not a list).
	const byDomain = new Map<string, string[]>();
	while (records.length < size) {
		const d = pick(random, DOMAINS);
		const kind = pick(random, KINDS);
		const name = camel(d, kind);
		const n = Math.floor(random() * Math.max(50, size / 20));
		const file = `src/${d}/${kind}${n}.ts`;
		const roll = random();
		const text =
			roll < 0.35
				? `${name}${n} ${pick(random, VERBS)} i dati delle ${d} su ${pick(random, STORES)} (${file}).`
				: roll < 0.6
					? `Il ${kind} delle ${d} ${n} ${pick(random, ISSUES)}: risolto aggiungendo un indice e un limite di pagina.`
					: roll < 0.8
						? `Per le ${d} ${n} si usa ${pick(random, STORES)} con chiave composta da codice e data.`
						: `Convenzione: i test delle ${d} ${n} stanno accanto al file in ${file.replace(".ts", ".test.ts")}.`;
		const peers = byDomain.get(d) ?? [];
		const links = peers.length && random() < 0.5 ? [pick(random, peers.slice(-50))] : undefined;
		const record = make(text, [d, file], links ? { links } : {});
		peers.push(record.id);
		byDomain.set(d, peers);
	}
	const unrelated = ["scrivi una poesia sul mare d'inverno", "quanto fa 17 per 23?", "traduci in inglese: buongiorno a tutti", "qual è la capitale dell'Australia?", "consigliami un film di fantascienza", "come si cucina il risotto ai funghi?", "spiegami la teoria della relatività in breve", "che tempo fa di solito a Lisbona in aprile?"];
	return { records, chains, supersedes, unrelated };
}
