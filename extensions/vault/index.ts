/**
 * Vault index: chunks with local vectors, saved as JSON. Updates are by content hash per chunk (unchanged chunks keep
 * their vector, deleted ones disappear, a different model rebuilds everything). Search is cosine with the model's
 * floor, optionally fused with BM25 (Reciprocal Rank Fusion).
 */
import { createHash } from "node:crypto";
import type { Embedder } from "../../pi-memory/src/embed.ts";
import { type VaultChunk, chunkMarkdown } from "./chunk.ts";

export interface VaultFile {
	/** Source id shown to the model: vault-relative path, or "CLAUDE.md". */
	path: string;
	source: string;
}

interface Entry {
	path: string;
	section: string;
	line: number;
	text: string;
	hash: string;
	tags: string[];
	links: string[];
	vector: number[];
}

export interface Hit {
	path: string;
	section: string;
	line: number;
	text: string;
	score: number;
	tags: string[];
}

export interface UpdateStats {
	files: number;
	chunks: number;
	embedded: number;
	reused: number;
	removed: number;
}

/** Progress of an update: sections done, and what the last batch was working on. */
export interface UpdateProgress {
	done: number;
	total: number;
	path: string;
	section: string;
	/** Files whose sections are all done / files with something to embed. */
	filesDone: number;
	filesTotal: number;
}

/** Small batches: the progress moves every couple of seconds on CPU. */
export const BATCH = 16;
export const INDEX_VERSION = 1;
/**
 * Added to the model's floor. Measured 20 Oct (e5-small, 337 sections of this repo's docs): the best cosine of off-topic
 * queries is 0.80-0.81, of on-topic concept queries 0.875-0.905, while the model's floor is 0.78 (lets everything through).
 * Small sample: recalibrate on the real vault.
 */
export const FLOOR_MARGIN = 0.06;
/** A chunk enters the results through BM25 alone only if it has a query word found in at most this share of the chunks (common words match everything). */
export const RARE_SHARE = 0.03;
export const hashOf = (chunk: VaultChunk) => createHash("sha256").update(`${chunk.path}\0${chunk.text}`).digest("hex").slice(0, 16);
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
	let sum = 0;
	for (let index = 0; index < a.length; index++) sum += a[index] * b[index];
	return sum;
};

/** Lowercase words without accents; 1-letter tokens dropped. */
export const tokenize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];

/** Narrow a search: notes with this tag (no #), or under this folder of the vault. */
export interface SearchFilter {
	tag?: string;
	folder?: string;
}

const norm = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** File name without folder and extension ("01-Architecture/Overview.md" -> "overview"). */
const baseName = (path: string) => norm(path.split("/").pop() ?? path).replace(/\.md$/, "");

export class VaultIndex {
	model = "";
	private entries: Entry[] = [];
	private bm?: { df: Map<string, number>; tf: Map<string, number>[]; length: number[]; avg: number };

	get size() {
		return this.entries.length;
	}

	get paths() {
		return [...new Set(this.entries.map((entry) => entry.path))];
	}

	/** Chunks of `files` and how many have no vector yet (what an update would embed); no model needed. */
	plan(files: VaultFile[], model: string) {
		const known = new Set(this.model === model ? this.entries.map((entry) => entry.hash) : []);
		const chunks = files.flatMap((file) => chunkMarkdown(file.path, file.source));
		const wanted = new Set(chunks.map(hashOf));
		return { chunks: chunks.length, pending: [...wanted].filter((hash) => !known.has(hash)).length, removed: [...known].filter((hash) => !wanted.has(hash)).length };
	}

	async update(files: VaultFile[], embedder: Embedder, onProgress?: (progress: UpdateProgress) => void, signal?: AbortSignal): Promise<UpdateStats> {
		const model = embedder.model ?? "unknown";
		const before = this.model === model ? this.entries : [];
		const byHash = new Map(before.map((entry) => [entry.hash, entry]));
		const chunks = files.flatMap((file) => chunkMarkdown(file.path, file.source).map((chunk) => ({ chunk, hash: hashOf(chunk) })));
		const todo = [...new Map(chunks.filter((item) => !byHash.has(item.hash)).map((item) => [item.hash, item])).values()];
		const vectors = new Map<string, number[]>();
		const filesTotal = new Set(todo.map((item) => item.chunk.path)).size;
		for (let start = 0; start < todo.length; start += BATCH) {
			if (signal?.aborted) throw new Error("annullato");
			const batch = todo.slice(start, start + BATCH);
			onProgress?.({ done: start, total: todo.length, path: batch[0].chunk.path, section: batch[0].chunk.section, filesDone: new Set(todo.slice(0, start).map((item) => item.chunk.path)).size, filesTotal });
			const result = await embedder.embed(batch.map((item) => item.chunk.text), "passage");
			batch.forEach((item, index) => vectors.set(item.hash, Array.from(result[index])));
		}
		if (todo.length) onProgress?.({ done: todo.length, total: todo.length, path: "", section: "", filesDone: filesTotal, filesTotal });
		const entries: Entry[] = chunks.map(({ chunk, hash }) => ({ path: chunk.path, section: chunk.section, line: chunk.line, text: chunk.text, hash, tags: chunk.tags, links: chunk.links, vector: byHash.get(hash)?.vector ?? vectors.get(hash)! }));
		const kept = new Set(entries.map((entry) => entry.hash));
		const removed = before.filter((entry) => !kept.has(entry.hash)).length;
		this.entries = entries;
		this.model = model;
		this.bm = undefined;
		return { files: files.length, chunks: entries.length, embedded: todo.length, reused: entries.length - todo.length, removed };
	}

	private bm25(query: string) {
		if (!this.bm) {
			const df = new Map<string, number>();
			const tf = this.entries.map((entry) => {
				const counts = new Map<string, number>();
				for (const token of tokenize(`${entry.text} ${entry.tags.join(" ")}`)) counts.set(token, (counts.get(token) ?? 0) + 1);
				for (const token of counts.keys()) df.set(token, (df.get(token) ?? 0) + 1);
				return counts;
			});
			const length = tf.map((counts) => [...counts.values()].reduce((sum, count) => sum + count, 0));
			this.bm = { df, tf, length, avg: length.reduce((sum, value) => sum + value, 0) / Math.max(1, length.length) };
		}
		const { df, tf, length, avg } = this.bm;
		const total = this.entries.length;
		const scores = new Float64Array(total);
		const rareDf = Math.max(1, Math.floor(total * RARE_SHARE));
		const rare = new Uint8Array(total);
		const matched = new Uint8Array(total);
		let usable = 0;
		for (const term of new Set(tokenize(query))) {
			const docs = df.get(term) ?? 0;
			// A word in over half of the chunks identifies nothing.
			if (!docs || docs / total > 0.5) continue;
			usable++;
			const idf = Math.log(1 + (total - docs + 0.5) / (docs + 0.5));
			tf.forEach((counts, position) => {
				const count = counts.get(term);
				if (count) matched[position]++;
				if (count && docs <= rareDf) rare[position] = 1;
				if (count) scores[position] += (idf * count * 2.2) / (count + 1.2 * (0.25 + (0.75 * length[position]) / avg));
			});
		}
		return { scores, rare, matched, usable };
	}

	/** mode "vector": cosine above the model floor. "hybrid": union of cosine-above-floor and BM25 matches, ranked by RRF. */
	async search(query: string, embedder: Embedder, k = 6, mode: "vector" | "hybrid" = "hybrid", filter: SearchFilter = {}): Promise<Hit[]> {
		if (!this.entries.length) return [];
		if ((embedder.model ?? "unknown") !== this.model) throw new Error("indice di un altro modello: aggiorna l'indice");
		const [vector] = await embedder.embed([query], "query");
		const floor = (embedder.semFloor ?? 0) + FLOOR_MARGIN;
		const tag = filter.tag?.replace(/^#/, "").toLowerCase();
		const folder = filter.folder?.replace(/^\/+|\/+$/g, "").toLowerCase();
		const allowed = (position: number) => {
			const entry = this.entries[position];
			return (!tag || entry.tags.some((item) => item.toLowerCase() === tag)) && (!folder || entry.path.toLowerCase().startsWith(`${folder}/`));
		};
		const cosine = this.entries.map((entry) => dot(vector, entry.vector));
		const semantic = cosine.map((score, position) => ({ score, position })).filter((item) => item.score >= floor && allowed(item.position)).sort((a, b) => b.score - a.score);
		const hit = (position: number, score: number): Hit => {
			const entry = this.entries[position];
			return { path: entry.path, section: entry.section, line: entry.line, text: entry.text, score, tags: entry.tags };
		};
		if (mode === "vector") return semantic.slice(0, k).map((item) => hit(item.position, item.score));
		const { scores: lexical, rare, matched, usable } = this.bm25(query);
		// Alone, BM25 admits a chunk only with a rare word AND at least half of the query's useful words.
		// Long natural-language questions (4+ useful words) are the vectors' job: BM25 only reorders what they found. Short queries (names, paths, codes) can enter through BM25 alone.
		const need = usable <= 3 ? Math.ceil(usable / 2) : Infinity;
		const ranked = [...lexical.keys()].filter((position) => allowed(position) && rare[position] && matched[position] >= need).sort((a, b) => lexical[b] - lexical[a]);
		const fused = new Map<number, number>();
		semantic.slice(0, 50).forEach((item, rank) => fused.set(item.position, (fused.get(item.position) ?? 0) + 1 / (60 + rank)));
		ranked.slice(0, 50).forEach((position, rank) => fused.set(position, (fused.get(position) ?? 0) + 1 / (60 + rank)));
		this.titleMatches(query).filter(allowed).forEach((position, rank) => fused.set(position, (fused.get(position) ?? 0) + 1 / (60 + rank)));
		return [...fused].sort((a, b) => b[1] - a[1]).slice(0, k).map(([position, score]) => hit(position, score));
	}

	/** First chunk of each note whose file name contains every word of a short query ("adr 007", "jsreport"): names are what people remember. */
	private titleMatches(query: string): number[] {
		const words = [...new Set(tokenize(query))];
		if (!words.length || words.length > 4) return [];
		const found: number[] = [];
		const seen = new Set<string>();
		this.entries.forEach((entry, position) => {
			if (seen.has(entry.path)) return;
			const name = baseName(entry.path);
			if (words.every((word) => name.includes(word))) {
				seen.add(entry.path);
				found.push(position);
			}
		});
		return found;
	}

	/** Notes linked from `path` and notes that link to it, by [[wikilink]] (matched on file name). */
	relations(path: string): { links: string[]; backlinks: string[] } {
		const name = baseName(path);
		const links = new Set<string>();
		const backlinks = new Set<string>();
		for (const entry of this.entries) {
			if (entry.path === path) entry.links.forEach((link) => links.add(link));
			else if (entry.links.some((link) => baseName(link) === name)) backlinks.add(entry.path);
		}
		return { links: [...links], backlinks: [...backlinks] };
	}

	toJSON() {
		return { version: INDEX_VERSION, model: this.model, entries: this.entries };
	}

	static fromJSON(data: { version?: number; model?: string; entries?: Entry[] }): VaultIndex {
		const index = new VaultIndex();
		if (data.version !== INDEX_VERSION) return index;
		index.model = data.model ?? "";
		index.entries = data.entries ?? [];
		return index;
	}
}
