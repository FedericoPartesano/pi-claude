/** Pure recall: hybrid score (semantic + BM25 + entities + one-step association) x strength, threshold, budget. */
import { strength } from "./strength.ts";
import type { MemoryRecord } from "./store.ts";
import { extractEntities } from "./entities.ts";
import { classifyRequest } from "./request.ts";
import { pushPpr } from "./ppr.ts";
import { VectorIndex } from "./vector-index.ts";

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
	/** deep = reached through the memory graph, not by the request's words or meaning. */
	via?: "deep";
}

const K1 = 1.2;
const B = 0.75;

/** Entities shared by more memories than this connect too much to mean anything: never expanded in the graph walk. */
export const HUB_DEGREE = 30;
/** Terms in more than this share of memories carry no information: skipped by BM25 (and they cost the most). */
const COMMON_TERM_SHARE = 0.2;
/** A term in at most this share of memories (or 3) identifies something by itself: a library, a file, a code. */
const RARE_TERM_SHARE = 0.005;
/** Weight of a match on a single, non-rare term. */
const SINGLE_COMMON_TERM = 0.6;

/** Depth: how recall walks the memory graph (Personalized PageRank by push, see ppr.ts). Tuned on bench/deep-bench.ts. */
/** Recency weight and time constant (days). Tuned on bench/longterm-sim.ts. */
export const RECENCY = { weight: 0.1, days: 7 };

export const DEPTH = {
	/** Strongest direct hits that seed the walk. */
	seeds: 5,
	/** PPR restart probability (HippoRAG 2: 0.5). */
	alpha: 0.5,
	epsilon: 1e-4,
	/** Seeds: hits within this share of the best one (a weak hit's neighbourhood is noise). */
	seedShare: 0.9,
	/** Seed weight = score^power: the walk starts mostly from the best hits. */
	power: 3,
	/** Share of the cues reserved to memories the walk reaches (shown as "collegato"). */
	slotShare: 0.4,
	/** Below this PPR mass relative to the top seed a reached memory is not worth a cue. */
	minMass: 1e-3,
};

/**
 * Many lists of positions in one block (CSR): a key → its slice of a single Int32Array. One object per index instead of
 * one per term or entity: at 100k memories that is tens of thousands of objects fewer.
 */
class Lists {
	private keys = new Map<string, number>();
	private starts: Int32Array;
	readonly data: Int32Array;
	/** Optional per-item byte (term frequency for postings). */
	readonly extra?: Uint8Array;

	/** Built a slice of keys at a time, the event loop free in between (see RecallIndex.build). */
	static async build(map: Map<string, number[]>, withExtra = false, slice = 4000): Promise<Lists> {
		const lists = new Lists(new Map(), withExtra, map);
		let k = 0;
		for (const [key, list] of map) {
			lists.push(key, list);
			if (++k % slice === 0) await new Promise((resolve) => setImmediate(resolve));
		}
		lists.close();
		return lists;
	}

	private offset = 0;
	private count = 0;
	private readonly withExtra: boolean;

	private push(key: string, list: number[]) {
		this.keys.set(key, this.count);
		this.starts[this.count++] = this.offset;
		if (this.withExtra) for (let i = 0; i < list.length; i += 2) {
			this.data[this.offset] = list[i];
			this.extra![this.offset++] = list[i + 1];
		}
		else for (const value of list) this.data[this.offset++] = value;
	}

	private close() {
		this.starts[this.count] = this.offset;
	}

	/** `sized` gives the sizes when the content is pushed later (async build); otherwise `map` is copied at once. */
	constructor(map: Map<string, number[]>, withExtra = false, sized?: Map<string, number[]>) {
		this.withExtra = withExtra;
		const source = sized ?? map;
		let size = 0;
		for (const list of source.values()) size += withExtra ? list.length / 2 : list.length;
		this.starts = new Int32Array(source.size + 1);
		this.data = new Int32Array(size);
		if (withExtra) this.extra = new Uint8Array(size);
		if (sized) return;
		for (const [key, list] of map) this.push(key, list);
		this.close();
	}

	/** [start, end) of a key's slice in data/extra; [0, 0] when absent. */
	range(key: string): [number, number] {
		const k = this.keys.get(key);
		return k === undefined ? [0, 0] : [this.starts[k], this.starts[k + 1]];
	}

	get(key: string): Int32Array {
		const [start, end] = this.range(key);
		return this.data.subarray(start, end);
	}
}

/** Accumulates what RecallIndex needs, one record at a time (so a build can be split into slices). */
class IndexBuilder {
	readonly positions: Map<string, number>;
	readonly lengths: Uint16Array;
	readonly postings = new Map<string, number[]>();
	readonly entityIndex = new Map<string, number[]>();
	readonly entityTokens = new Map<string, number[]>();
	readonly links = new Map<number, Set<number>>();
	total = 0;
	private readonly records: MemoryRecord[];

	constructor(records: MemoryRecord[]) {
		this.records = records;
		this.positions = new Map(records.map((record, position) => [record.id, position]));
		this.lengths = new Uint16Array(records.length);
	}

	private link(from: number, to: number) {
		const set = this.links.get(from) ?? new Set<number>();
		set.add(to);
		this.links.set(from, set);
	}

	add(position: number) {
		const record = this.records[position];
		const counts = new Map<string, number>();
		const terms = stems(record.text);
		for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
		this.lengths[position] = Math.min(65535, terms.length);
		this.total += terms.length;
		// Pairs (position, frequency) flattened in one array per term.
		for (const [term, frequency] of counts) {
			const list = this.postings.get(term) ?? [];
			list.push(position, Math.min(255, frequency));
			this.postings.set(term, list);
		}
		const tokens = new Set<string>();
		for (const entity of record.entities) {
			const list = this.entityIndex.get(entity) ?? [];
			list.push(position);
			this.entityIndex.set(entity, list);
			for (const token of stems(entity)) tokens.add(token);
		}
		for (const token of tokens) {
			const list = this.entityTokens.get(token) ?? [];
			list.push(position);
			this.entityTokens.set(token, list);
		}
		for (const id of record.links ?? []) {
			const other = this.positions.get(id);
			if (other === undefined || other === position) continue;
			this.link(position, other);
			this.link(other, position);
		}
	}
}

export class RecallIndex {
	readonly records: MemoryRecord[];
	private postings: Lists;
	private lengths: Uint16Array;
	private average = 1;
	private entityIndex: Lists;
	/** Entity stem → positions of records with an entity containing it: entity matching without a full scan. */
	private entityTokens: Lists;
	/** Explicit links by position, both ways (only records that have some). */
	private links = new Map<number, Int32Array>();
	readonly positions: Map<string, number>;
	private vectorIndexes = new WeakMap<Map<string, Float32Array>, VectorIndex>();
	/** stems() of entities, for the few hundred candidates of a request (bounded). */
	private entityStemCache = new Map<string, string[]>();

	constructor(records: MemoryRecord[], prepared?: IndexBuilder, lists?: { postings: Lists; entityIndex: Lists; entityTokens: Lists }) {
		this.records = records;
		let builder = prepared;
		if (!builder) {
			builder = new IndexBuilder(records);
			for (let position = 0; position < records.length; position++) builder.add(position);
		}
		this.positions = builder.positions;
		this.lengths = builder.lengths;
		this.average = builder.total / (records.length || 1) || 1;
		this.postings = lists?.postings ?? new Lists(builder.postings, true);
		this.entityIndex = lists?.entityIndex ?? new Lists(builder.entityIndex);
		this.entityTokens = lists?.entityTokens ?? new Lists(builder.entityTokens);
		for (const [position, set] of builder.links) this.links.set(position, Int32Array.from(set));
	}

	/**
	 * The same index, built a slice at a time with the event loop free in between: at 100k memories the constructor
	 * held the UI thread for seconds (typing frozen). Used to warm the index in the background.
	 */
	static async build(records: MemoryRecord[], slice = 2000): Promise<RecallIndex> {
		const builder = new IndexBuilder(records);
		for (let position = 0; position < records.length; position++) {
			builder.add(position);
			if (position % slice === slice - 1) await new Promise((resolve) => setImmediate(resolve));
		}
		const postings = await Lists.build(builder.postings, true);
		const entityIndex = await Lists.build(builder.entityIndex);
		const entityTokens = await Lists.build(builder.entityTokens);
		return new RecallIndex(records, builder, { postings, entityIndex, entityTokens });
	}

	private entityStems(entity: string): string[] {
		let value = this.entityStemCache.get(entity);
		if (!value) {
			if (this.entityStemCache.size > 5000) this.entityStemCache.clear();
			value = stems(entity);
			this.entityStemCache.set(entity, value);
		}
		return value;
	}

	private recencyCache = new WeakMap<MemoryRecord, { day: string; value: number }>();
	/** 1 for a memory touched today, fading with a RECENCY.days time constant. */
	recencyOf(record: MemoryRecord, today: string): number {
		const cached = this.recencyCache.get(record);
		if (cached && cached.day === today) return cached.value;
		const touched = [record.last, record.lastUsed, record.created].filter(Boolean).sort().pop();
		const age = touched ? Math.max(0, (Date.parse(today) - Date.parse(touched)) / 86_400_000) : 365;
		const value = Number.isFinite(age) ? Math.exp(-age / RECENCY.days) : 0;
		this.recencyCache.set(record, { day: today, value });
		return value;
	}

	private strengthCache = new WeakMap<MemoryRecord, { day: string; last: string; confirmations: number; value: number }>();
	/** strength() per record, computed once a day (it parses dates). */
	strengthOf(record: MemoryRecord, today: string): number {
		const cached = this.strengthCache.get(record);
		if (cached && cached.day === today && cached.last === record.last && cached.confirmations === record.confirmations) return cached.value;
		const value = strength(record, today);
		this.strengthCache.set(record, { day: today, last: record.last, confirmations: record.confirmations, value });
		return value;
	}

	/** The vector index for a set of vectors, built once (sign bits + exact rescoring). */
	vectorsFor(vectors: Map<string, Float32Array>): VectorIndex {
		let index = this.vectorIndexes.get(vectors);
		if (!index) {
			index = new VectorIndex(this.records.map((record) => record.id), vectors);
			this.vectorIndexes.set(vectors, index);
		}
		return index;
	}

	/** Saturating BM25 in [0, 1) per record position (only records sharing a term are present). */
	bm25(query: string): Map<number, number> {
		const out = new Map<number, number>();
		// Small stores behave like a 300-memory corpus, so idf (and the threshold) does not depend on store size.
		const n = Math.max(this.records.length, 300);
		const common = Math.max(50, this.records.length * COMMON_TERM_SHARE);
		const rare = Math.max(3, this.records.length * RARE_TERM_SHARE);
		/** Per record: how many query terms it shares, and whether one of them is rare. */
		const evidence = new Map<number, { terms: number; rare: boolean }>();
		for (const term of new Set(stems(query))) {
			const [start, end] = this.postings.range(term);
			const size = end - start;
			if (size === 0 || size > common) continue;
			const idf = Math.log(1 + (n - size + 0.5) / (size + 0.5));
			for (let i = start; i < end; i++) {
				const position = this.postings.data[i];
				const frequency = this.postings.extra![i];
				const part = idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * this.lengths[position]) / this.average)));
				out.set(position, (out.get(position) ?? 0) + part);
				const seen = evidence.get(position) ?? { terms: 0, rare: false };
				seen.terms++;
				seen.rare ||= size <= rare;
				evidence.set(position, seen);
			}
		}
		// A single common word in common is not evidence ("scrivi una poesia" matched every memory that "scrive").
		for (const [position, score] of out) {
			const seen = evidence.get(position)!;
			out.set(position, (1 - Math.exp(-score / 5)) * (seen.terms === 1 && !seen.rare ? SINGLE_COMMON_TERM : 1));
		}
		return out;
	}

	/** Entities of each record cited by the query (extracted identifiers/paths or plain mentions). */
	entityMatches(query: string): Map<number, number> {
		const out = new Map<number, number>();
		const mentioned = new Set(extractEntities(query));
		const queryStems = new Set(stems(query));
		const candidates = new Set<number>();
		for (const entity of mentioned) for (const position of this.entityIndex.get(entity)) candidates.add(position);
		const common = Math.max(HUB_DEGREE * 10, this.records.length * 0.01);
		for (const token of queryStems) {
			const list = this.entityTokens.get(token);
			// A token in thousands of entities (a domain name) identifies nothing; BM25 still weighs it.
			if (list.length <= common) for (const position of list) candidates.add(position);
		}
		for (const position of candidates) {
			let matches = 0;
			for (const entity of this.records[position].entities) {
				const tokens = this.entityStems(entity);
				if (mentioned.has(entity) || (tokens.length > 0 && tokens.every((token) => queryStems.has(token)))) matches++;
			}
			if (matches > 0) out.set(position, Math.min(1, 0.6 + 0.2 * (matches - 1)));
		}
		return out;
	}

	/**
	 * Graph for the walk, over memory positions: explicit links, and memories sharing a specific entity (one used by at
	 * most HUB_DEGREE memories) are direct neighbours — a chain through a shared file is as short as a linked one.
	 */
	neighbors = (node: string): string[] => {
		const position = Number(node.slice(1));
		const record = this.records[position];
		const out = new Set<number>();
		for (const other of this.links.get(position) ?? []) out.add(other);
		for (const entity of record.entities) {
			const members = this.entityIndex.get(entity);
			if (members.length > HUB_DEGREE) continue;
			for (const other of members) if (other !== position) out.add(other);
		}
		return [...out].map((other) => `m${other}`);
	};

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
	/** false = no graph walk (direct hits only). */
	deep?: boolean;
}

/** Semantic candidates kept per request (the vector index rescores a few hundred, whatever the store size). */
const SEMANTIC_CANDIDATES = 64;
/** Lexical candidates fully scored per request. */
const LEXICAL_CANDIDATES = 300;

export function recall(index: RecallIndex, query: string, options: RecallOptions): { hits: Scored[] } {
	const base = options.threshold ?? DEFAULT_THRESHOLD;
	const threshold = classifyRequest(query) === "inquiry" ? Math.max(base, options.inquiryThreshold ?? INQUIRY_THRESHOLD) : base;
	const floor = options.semFloor ?? 0.15;
	const span = options.semSpan ?? 1 - floor;
	const bm = index.bm25(query);
	const ent = index.entityMatches(query);
	const sem = new Map<number, number>();
	if (options.queryVector && options.vectors && options.vectors.size > 0) {
		for (const hit of index.vectorsFor(options.vectors).search(options.queryVector, SEMANTIC_CANDIDATES)) {
			const value = Math.max(0, Math.min(1, (hit.score - floor) / span));
			if (value > 0) sem.set(hit.position, value);
		}
	}
	const eligible = (record: MemoryRecord) => ((record.status === "active" && record.state !== "dormant") || options.includeSuperseded) && !options.exclude?.has(record.id);
	// Strength (confirmations, slow fading) plus recency (Generative Agents): among memories equally relevant to the
	// request, the one touched in the last weeks comes first (the current state of a topic, not its history).
	const factor = (record: MemoryRecord) => 0.85 + 0.15 * index.strengthOf(record, options.today) + RECENCY.weight * index.recencyOf(record, options.today);
	const direct = new Map<number, number>();
	// Full scoring only for the best few hundred by lexical evidence plus the semantic ones: a common word can hit
	// thousands of memories, and scoring them all was most of the time at 100k.
	const lexicalOnly = new Map<number, number>();
	for (const [position, value] of bm) lexicalOnly.set(position, value);
	for (const [position, value] of ent) lexicalOnly.set(position, Math.max(lexicalOnly.get(position) ?? 0, value));
	const lexicalTop = lexicalOnly.size <= LEXICAL_CANDIDATES ? [...lexicalOnly.keys()] : [...lexicalOnly].sort((a, b) => b[1] - a[1]).slice(0, LEXICAL_CANDIDATES).map(([position]) => position);
	for (const position of new Set<number>([...lexicalTop, ...sem.keys()])) {
		const record = index.records[position];
		if (!eligible(record)) continue;
		// Lexical evidence (BM25 + entities) alone is enough; semantics can only add to it.
		const [b, e] = [bm.get(position) ?? 0, ent.get(position) ?? 0];
		const lexical = 0.8 * Math.max(b, e) + 0.2 * Math.min(b, e);
		const score = Math.max(lexical, SEM_WEIGHT * (sem.get(position) ?? 0) + (1 - SEM_WEIGHT) * lexical);
		direct.set(position, score * factor(record));
	}
	const ranked = [...direct].map(([position, score]) => ({ position, score })).sort((a, b) => b.score - a.score);
	const passing = ranked.filter((item) => item.score >= threshold);
	const limit = options.limit ?? RECALL_LIMIT;
	// Relative cut: weak companions of a strong hit are noise (and tokens).
	const directHits = passing.filter((item) => item.score >= (passing[0]?.score ?? 0) * RELATIVE_CUT);
	if (directHits.length === 0) return { hits: [] };
	const slots = options.deep === false ? 0 : Math.max(1, Math.round(limit * DEPTH.slotShare));
	const chosen = directHits.slice(0, Math.max(1, limit - slots));
	const hits: Scored[] = chosen.map((item) => ({ record: index.records[item.position], score: item.score }));
	if (slots > 0) {
		// Depth: Personalized PageRank from the strongest hits over the memory graph. What the request does not mention
		// but its hits lead to (the reason two links away) fills the reserved cues, strongest mass first.
		const top = directHits[0].score;
		const seeds = directHits.filter((item) => item.score >= top * DEPTH.seedShare).slice(0, DEPTH.seeds);
		const mass = pushPpr(new Map(seeds.map((seed) => [`m${seed.position}`, seed.score ** DEPTH.power])), index.neighbors, { alpha: DEPTH.alpha, epsilon: DEPTH.epsilon });
		const reference = Math.max(...seeds.map((seed) => mass.get(`m${seed.position}`) ?? 0)) || 1;
		const taken = new Set(chosen.map((item) => item.position));
		const reached = [...mass]
			.map(([node, value]) => ({ position: Number(node.slice(1)), share: value / reference }))
			.filter((item) => !taken.has(item.position) && item.share >= DEPTH.minMass && eligible(index.records[item.position]))
			.sort((a, b) => b.share - a.share)
			.slice(0, slots);
		for (const item of reached) hits.push({ record: index.records[item.position], score: top * Math.min(1, item.share), via: "deep" });
		// Unused deep slots go back to direct hits.
		for (const item of directHits.slice(chosen.length, chosen.length + slots - reached.length)) hits.push({ record: index.records[item.position], score: item.score });
	}
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

/** Cues: the same ceiling as the old recall (~300 tokens), however many memories match; usually far less. */
export const CUES_BUDGET_CHARS = RECALL_BUDGET_CHARS;
const FULL_CUES = 2;
const FULL_CUE_CHARS = 180;
const CUE_CHARS = 70;

/** How many cues a request deserves: none for small talk, a few for questions, more for tasks (tetto fisso). */
export function cueLimit(query: string): number {
	if (isSmallTalk(query)) return 0;
	const kind = classifyRequest(query);
	return kind === "edit" ? 12 : kind === "inquiry" ? 6 : 8;
}

const clipTo = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Recall as cues: the strongest two in full (clipped), the rest as one short line (the gist written by /dream, or the
 * text clipped), each with its #id so the model can open it with `ricorda`. Same budget whatever the store size.
 */
export function renderCues(hits: Scored[], limit: number, budget = CUES_BUDGET_CHARS): string {
	const lines: string[] = [];
	let used = 0;
	for (const [index, { record, via }] of hits.slice(0, limit).entries()) {
		const body = index < FULL_CUES ? clipTo(record.text, FULL_CUE_CHARS) : clipTo(record.gist ?? record.text, CUE_CHARS);
		// Reached through the graph: the model should read it as related context, not as an answer to the words.
		const line = `- ${via === "deep" ? "↳ collegato " : ""}[${record.type}] ${body} #${record.id}`;
		if (used + line.length + 1 > budget) {
			if (index < FULL_CUES) continue;
			break;
		}
		lines.push(line);
		used += line.length + 1;
	}
	return lines.length === 0 ? "" : [RECALL_HEADER, ...lines].join("\n");
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
