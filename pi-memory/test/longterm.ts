/**
 * A simulated year of use (bench/longterm-sim.ts prints it, test/longterm.test.ts guards it). Topics come and go (each
 * active ~60 days), memories are added daily with links, requests hit the active topics, rare-but-important rules are
 * asked once a month, and every day the /dream lifecycle runs (usage from the recall log, dormant / awake / forgotten).
 */
import { applyUsage, lifecycle } from "../src/forget.ts";
import { RecallIndex, cueLimit, recall, renderCues } from "../src/recall.ts";
import type { MemoryRecord } from "../src/store.ts";
import { rng } from "./corpus.ts";

export interface Month {
	day: number;
	stored: number;
	active: number;
	dormant: number;
	forgotten: number;
	foundShare: number;
	rulesFound: number;
	rulesAsked: number;
	closedFound: number;
	closed: number;
	maxTokens: number;
	p95: number;
}

export function simulate(DAYS = 365): Month[] {
const random = rng(11);
const start = Date.parse("2026-01-01");
const dayOf = (d: number) => new Date(start + d * 86_400_000).toISOString().slice(0, 10);
const NOUNS = ["fatture", "ordini", "magazzino", "spedizioni", "clienti", "fornitori", "listini", "pagamenti", "resi", "promozioni", "catalogo", "utenti", "permessi", "notifiche", "report", "audit", "import", "export", "sincronizzazione", "ricerca"];
const TOPICS = Array.from({ length: 60 }, (_, i) => ({ name: `${NOUNS[i % NOUNS.length]}${100 + i}`, file: `src/${NOUNS[i % NOUNS.length]}/modulo${100 + i}.ts`, from: Math.floor((i * (DAYS - 60)) / 60), to: Math.floor((i * (DAYS - 60)) / 60) + 60 }));
const FACTS = ["usa una coda con concorrenza {n}", "salva le date in UTC e converte nella UI", "ha un timeout di {n} secondi", "valida i dati con uno schema zod", "pagina i risultati da {n} righe", "scrive un audit per ogni modifica", "legge da una vista materializzata aggiornata ogni {n} minuti", "manda una notifica email a fine elaborazione"];

let records: MemoryRecord[] = [];
let counter = 0;
const newest = new Map<string, string>();
const add = (text: string, extra: Partial<MemoryRecord>, today: string) => {
	const record: MemoryRecord = { id: `r${++counter}`, type: "fatto", text, pinned: false, confirmations: 1, created: today, last: today, status: "active", entities: [], ...extra };
	records.push(record);
	return record;
};
// Rare but important: confirmed several times long ago, asked once a month.
const RULES = Array.from({ length: 20 }, (_, i) => ({ id: "", text: `Regola ${i}: il rilascio del servizio ${NOUNS[i]} avviene solo dal branch release-${i} con approvazione del referente`, query: `come rilascio il servizio ${NOUNS[i]}?` }));
for (const rule of RULES) rule.id = add(rule.text, { type: "decisione", confirmations: 3, entities: [`release-${RULES.indexOf(rule)}`] }, dayOf(0)).id;

const forgotten: MemoryRecord[] = [];
const events: { at: string; hits: { id: string }[] }[] = [];
let since = "";
const months: Month[] = [];
let asked = 0;
let found = 0;
let rulesAsked = 0;
let rulesFound = 0;
let maxChars = 0;
const times: number[] = [];
for (let d = 0; d < DAYS; d++) {
	const today = dayOf(d);
	const active = TOPICS.filter((topic) => d >= topic.from && d < topic.to);
	for (const topic of active) {
		if (random() > 0.35) continue;
		const fact = FACTS[Math.floor(random() * FACTS.length)].replace("{n}", String(1 + Math.floor(random() * 50)));
		const previous = newest.get(topic.name);
		const record = add(`Il modulo ${topic.name} ${fact} (${topic.file}).`, { entities: [topic.name, topic.file], links: previous && random() < 0.5 ? [previous] : undefined }, today);
		newest.set(topic.name, record.id);
	}
	const index = new RecallIndex(records);
	const ask = (query: string, options: { deep?: boolean } = {}) => {
		const started = performance.now();
		const limit = cueLimit(query);
		const hits = recall(index, query, { today, limit, includeSuperseded: options.deep, threshold: options.deep ? 0.25 : undefined }).hits;
		times.push(performance.now() - started);
		const text = renderCues(hits, limit);
		maxChars = Math.max(maxChars, text.length);
		if (!options.deep) events.push({ at: `${today}T12:00:00Z`, hits: hits.map((hit) => ({ id: hit.record.id })) });
		return hits.map((hit) => hit.record.id);
	};
	for (let q = 0; q < 8 && active.length; q++) {
		const topic = active[Math.floor(random() * active.length)];
		const target = newest.get(topic.name);
		if (!target) continue;
		asked++;
		if (ask(`come funziona il modulo ${topic.name}? devo modificarlo`).includes(target)) found++;
	}
	if (d % 30 === 15) for (const rule of RULES) {
		rulesAsked++;
		if (ask(rule.query).includes(rule.id)) rulesFound++;
	}
	// The daily /dream: usage from the recall log, then the lifecycle.
	records = applyUsage(records, events, "", since);
	since = events[events.length - 1]?.at ?? since;
	const cycle = lifecycle(records, today);
	records = cycle.records;
	forgotten.push(...cycle.forgotten);
	if (d % 30 === 29 || d === DAYS - 1) {
		const dormant = records.filter((record) => record.state === "dormant").length;
		// A topic closed long ago: still found by a deep search (dormant in the store or among the forgotten)?
		const closed = TOPICS.filter((topic) => topic.to < d - 120);
		let deepFound = 0;
		for (const topic of closed) {
			const pool = new RecallIndex([...records, ...forgotten.map((record) => ({ ...record, state: undefined }))]);
			const hits = recall(pool, `come funziona il modulo ${topic.name}?`, { today, limit: 6, includeSuperseded: true, threshold: 0.25 }).hits;
			if (hits.some((hit) => hit.record.entities.includes(topic.name))) deepFound++;
		}
		const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)] ?? 0;
		months.push({ day: d + 1, stored: records.length, active: records.length - dormant, dormant, forgotten: forgotten.length, foundShare: asked ? found / asked : 1, rulesFound, rulesAsked, closedFound: deepFound, closed: closed.length, maxTokens: Math.round(maxChars / 3.6), p95 });

		asked = found = 0;
		times.length = 0;
	}
}
return months;
}
