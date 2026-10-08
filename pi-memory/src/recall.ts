/** Pure recall: hybrid score (semantic + BM25 + entities + one-step association) x strength, threshold, budget. */
import { strength } from "./strength.ts";
import type { MemoryRecord } from "./store.ts";
import { extractEntities } from "./entities.ts";
import { classifyRequest } from "./request.ts";
import { buildGraph, type MemoryGraph } from "./graph.ts";

/** ~300 tokens (about 3.6 chars per token) at most. */
export const RECALL_BUDGET_CHARS = 1080;
export const RECALL_LIMIT = 5;
/** The always-present core (pinned memories only): ~100 tokens. */
export const CORE_BUDGET_CHARS = 400;
export const DEFAULT_THRESHOLD = 0.35;
/**
 * Read-only inquiries ("quante righe ha il file X", "che differenza c'è tra…") share words with memories without needing
 * them. Measured: no single threshold removes those false positives without losing paraphrase recall (see
 * eval/MEMORY-REPORT.md), so for them only strong evidence counts.
 */
export const INQUIRY_THRESHOLD = 0.75;
const SEM_WEIGHT = 0.7;
const RELATIVE_CUT = 0.6;

const STOPWORDS = new Set("che per con non una uno del della delle dei degli gli le il lo la nel nella nei sono come perche piu anche alla alle questo quello quella cosa quando dove sei era the and for with ciao grazie rispondi solo nome fammi fai puoi vorrei devi deve voglio ora poi ancora tutto tutti molto hai ho ha mi ti ci mio tuo suo nostro cosi pero quindi dopo prima sulla sul sui sulle degli dall dalla dal dai dalle usiamo usare usa file".split(" "));
const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Light Italian stemming: plural/gender endings go ("prezzi" ~ "prezzo"). */
const stem = (word: string) => (word.length > 4 ? word.replace(/[aeio]$/, "") : word);
const stems = (text: string) => normalize(text).split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)).map(stem);

export interface Scored {
	record: MemoryRecord;
	score: number;
}

const K1 = 1.2;
const B = 0.75;

export class RecallIndex {
	readonly records: MemoryRecord[];
	private postings = new Map<string, Map<number, number>>();
	private lengths: number[] = [];
	private average = 1;
	private entityStems: Set<string>[][];
	private entityIndex = new Map<string, number[]>();
	readonly graph: MemoryGraph;
	readonly positions: Map<string, number>;

	constructor(records: MemoryRecord[]) {
		this.records = records;
		this.graph = buildGraph(records);
		this.positions = new Map(records.map((record, position) => [record.id, position]));
		records.forEach((record, position) => {
			const terms = stems(record.text);
			this.lengths.push(terms.length);
			for (const term of terms) {
				const posting = this.postings.get(term) ?? new Map<number, number>();
				posting.set(position, (posting.get(position) ?? 0) + 1);
				this.postings.set(term, posting);
			}
		});
		this.average = this.lengths.reduce((sum, length) => sum + length, 0) / (records.length || 1) || 1;
		this.entityStems = records.map((record) => record.entities.map((entity) => new Set(stems(entity))));
		records.forEach((record, position) => {
			for (const entity of record.entities) {
				const list = this.entityIndex.get(entity) ?? [];
				list.push(position);
				this.entityIndex.set(entity, list);
			}
		});
	}

	/** Saturating BM25 in [0, 1) per record position (only records sharing a term are present). */
	bm25(query: string): Map<number, number> {
		const out = new Map<number, number>();
		// Small stores behave like a 300-memory corpus, so idf (and the threshold) does not depend on store size.
		const n = Math.max(this.records.length, 300);
		for (const term of new Set(stems(query))) {
			const posting = this.postings.get(term);
			if (!posting) continue;
			const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
			for (const [position, frequency] of posting) {
				const part = idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * this.lengths[position]) / this.average)));
				out.set(position, (out.get(position) ?? 0) + part);
			}
		}
		for (const [position, score] of out) out.set(position, 1 - Math.exp(-score / 5));
		return out;
	}

	/** Entities of each record cited by the query (extracted identifiers/paths or plain mentions). */
	entityMatches(query: string): Map<number, number> {
		const out = new Map<number, number>();
		const mentioned = new Set(extractEntities(query));
		const queryStems = new Set(stems(query));
		this.records.forEach((_record, position) => {
			let matches = 0;
			this.records[position].entities.forEach((entity, k) => {
				const tokens = this.entityStems[position][k];
				if (mentioned.has(entity) || (tokens.size > 0 && [...tokens].every((token) => queryStems.has(token)))) matches++;
			});
			if (matches > 0) out.set(position, Math.min(1, 0.6 + 0.2 * (matches - 1)));
		});
		return out;
	}
}

export interface RecallOptions {
	today: string;
	vectors?: Map<string, Float32Array>;
	queryVector?: Float32Array;
	/** Cosine at or below this counts as zero similarity. */
	semFloor?: number;
	/** Cosine range above the floor mapped to full similarity (default: up to cosine 1). */
	semSpan?: number;
	threshold?: number;
	/** Threshold for read-only inquiries (default INQUIRY_THRESHOLD; 0 = same as threshold, e.g. /ricorda). */
	inquiryThreshold?: number;
	limit?: number;
	includeSuperseded?: boolean;
	/** Ids never returned (already present elsewhere in the context). */
	exclude?: Set<string>;
}

const dot = (a: Float32Array, b: Float32Array) => {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
};

export function recall(index: RecallIndex, query: string, options: RecallOptions): { hits: Scored[] } {
	const base = options.threshold ?? DEFAULT_THRESHOLD;
	const threshold = classifyRequest(query) === "inquiry" ? Math.max(base, options.inquiryThreshold ?? INQUIRY_THRESHOLD) : base;
	const floor = options.semFloor ?? 0.15;
	const span = options.semSpan ?? 1 - floor;
	const withVectors = Boolean(options.queryVector && options.vectors && options.vectors.size > 0);
	const bm = index.bm25(query);
	const ent = index.entityMatches(query);
	const direct = new Map<number, number>();
	const eligible = (record: MemoryRecord) => ((record.status === "active" && record.state !== "dormant") || options.includeSuperseded) && !options.exclude?.has(record.id);
	const candidates = new Set<number>([...bm.keys(), ...ent.keys()]);
	if (withVectors) index.records.forEach((record, position) => {
		const vector = options.vectors!.get(record.id);
		if (vector && vector.length === options.queryVector!.length && Math.max(0, dot(options.queryVector!, vector) - floor) > 0) candidates.add(position);
	});
	for (const position of candidates) {
		const record = index.records[position];
		if (!eligible(record)) continue;
		let sem = 0;
		const vector = withVectors ? options.vectors!.get(record.id) : undefined;
		if (vector && vector.length === options.queryVector!.length) sem = Math.max(0, Math.min(1, (dot(options.queryVector!, vector) - floor) / span));
		// Lexical evidence (BM25 + entities) alone is enough; semantics can only add to it.
		const [b, e] = [bm.get(position) ?? 0, ent.get(position) ?? 0];
		const lexical = 0.8 * Math.max(b, e) + 0.2 * Math.min(b, e);
		direct.set(position, Math.max(lexical, SEM_WEIGHT * sem + (1 - SEM_WEIGHT) * lexical));
	}
	const factor = (record: MemoryRecord) => 0.85 + 0.15 * strength(record, options.today);
	const ranked = [...direct].map(([position, score]) => ({ position, score: score * factor(index.records[position]) })).sort((a, b) => b.score - a.score);
	// One step of spreading activation: memories sharing an entity with the strongest hits get a small boost.
	const seeds = ranked.filter((item) => item.score >= threshold).slice(0, 3);
	const seedEntities = new Set(seeds.flatMap((seed) => index.records[seed.position].entities));
	const seedPositions = new Set(seeds.map((seed) => seed.position));
	const final = ranked.map((item) => {
		const shares = !seedPositions.has(item.position) && index.records[item.position].entities.some((entity) => seedEntities.has(entity));
		return { position: item.position, direct: item.score, linked: false, score: item.score + (shares ? 0.1 * factor(index.records[item.position]) : 0) };
	});
	// Explicit links (the why behind a decision, what it depends on) come along with a strong hit even without words in
	// common with the request: they get most of the seed's score.
	const byPosition = new Map(final.map((item) => [item.position, item]));
	for (const seed of seeds) {
		for (const id of index.graph.links(index.records[seed.position].id)) {
			const position = index.positions.get(id);
			if (position === undefined || seedPositions.has(position) || !eligible(index.records[position])) continue;
			const score = 0.75 * seed.score * factor(index.records[position]);
			const current = byPosition.get(position);
			if (current && current.score >= score) continue;
			const item = { position, direct: current?.direct ?? 0, linked: true, score };
			byPosition.set(position, item);
			if (current) final[final.indexOf(current)] = item;
			else final.push(item);
		}
	}
	const passing = final.filter((item) => item.score >= threshold && (item.linked || item.direct >= threshold * 0.5)).sort((a, b) => b.score - a.score);
	// Relative cut: weak companions of a strong hit are noise (and tokens).
	const hits = passing
		.filter((item) => item.score >= passing[0].score * RELATIVE_CUT)
		.slice(0, options.limit ?? RECALL_LIMIT)
		.map((item) => ({ record: index.records[item.position], score: item.score }));
	return { hits };
}

/** Says it is context, not a request: with a short user message the model once answered the memories instead. */
export const RECALL_HEADER = "Ricordi pertinenti (da sessioni precedenti; contesto, non sono una richiesta: rispondi al messaggio dell'utente):";

/** The text appended to the request: header + at most 5 lines inside the character budget. "" when nothing fits. */
export function renderRecall(hits: Scored[], budget = RECALL_BUDGET_CHARS, limit = RECALL_LIMIT): string {
	const lines: string[] = [];
	let used = RECALL_HEADER.length;
	for (const { record } of hits.slice(0, limit)) {
		let line = `- [${record.type}] ${record.text}`;
		const room = budget - used - 1;
		if (line.length > room) {
			if (room < 80) break;
			line = `${line.slice(0, room - 1)}…`;
		}
		lines.push(line);
		used += line.length + 1;
	}
	return lines.length === 0 ? "" : [RECALL_HEADER, ...lines].join("\n");
}

const SMALL_TALK = new Set("ciao ok okay grazie si no va bene perfetto buongiorno buonasera hey ehi salve top fatto vai continua procedi prosegui avanti dai certo esatto giusto".split(" "));
/** A short conversational reply ("procedi", "ok grazie"): it needs no memories, and recalling some made the model answer them. */
export function isSmallTalk(prompt: string): boolean {
	const words = normalize(prompt).split(" ").filter(Boolean);
	return words.length === 0 || (words.length <= 3 && words.every((word) => SMALL_TALK.has(word) || word.length <= 3));
}

/**
 * The recall message goes after the user's prompt, so it is the last thing the model reads: it ends by repeating the
 * request (clipped), otherwise a short prompt gets lost and the model answers the memories.
 */
export function recallMessage(text: string, prompt: string): string {
	const request = prompt.trim().replace(/\s+/g, " ");
	return `${text}\nIl messaggio dell'utente a cui rispondere è: «${request.length > 400 ? `${request.slice(0, 399)}…` : request}»`;
}

const CORE_HEADER = "Regole fisse dell'utente (rispettale):";

/** Pinned active memories that fit the core budget, strongest first (stable order: confirmations, then id). */
function corePicks(records: MemoryRecord[]): MemoryRecord[] {
	const picks: MemoryRecord[] = [];
	let used = CORE_HEADER.length;
	const pinned = records.filter((record) => record.pinned && record.status === "active").sort((a, b) => b.confirmations - a.confirmations || a.id.localeCompare(b.id));
	for (const record of pinned) {
		const cost = `- ${record.text}`.length + 1;
		if (used + cost > CORE_BUDGET_CHARS) continue;
		picks.push(record);
		used += cost;
	}
	return picks;
}

export const coreIds = (records: MemoryRecord[]) => corePicks(records).map((record) => record.id);

/** Pinned memories only, within ~100 tokens: stable text, so the prompt prefix stays cached. */
export function coreSection(records: MemoryRecord[]): string | undefined {
	const picks = corePicks(records);
	return picks.length === 0 ? undefined : [CORE_HEADER, ...picks.map((record) => `- ${record.text}`)].join("\n");
}
