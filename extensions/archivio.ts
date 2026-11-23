/**
 * Archive of the compacted history ("small live context, big archive").
 *
 * A compaction keeps the live context small but drops the details. They are not lost: Pi's session file still holds
 * every entry. After the first compaction this extension turns on one tool, `richiama`, that searches what the
 * compaction left out and returns a few short excerpts. Excerpts arrive as a tool result (appended), so the cached
 * prefix is never rewritten. No compaction yet → no tool, no prompt text, zero fixed cost. Search is lexical (BM25),
 * so there is no model download and no dependency.
 */
import { readFileSync, statSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface Chunk {
	entryId: string;
	role: string;
	label: string;
	text: string;
}

export interface Hit extends Chunk {
	score: number;
	/** Distinct query terms found in the chunk. */
	matched: number;
	/** Semantic only: how many standard deviations above the mean similarity of the whole archive. */
	z?: number;
}

const CHUNK_CHARS = Number(process.env.PI_ARCHIVE_CHUNK ?? 900);
const OUTPUT_CHARS = 3500;
// Auto recall fires only when a chunk shares enough of the request's terms (measured: 2 terms fired on 75% of prompts).
const MIN_MATCHED = Number(process.env.PI_ARCHIVE_MIN ?? 4);
const MIN_SHARE = Number(process.env.PI_ARCHIVE_SHARE ?? 0.4);

interface Entry {
	type?: string;
	id?: string;
	firstKeptEntryId?: string;
	message?: { role?: string; toolName?: string; toolCallId?: string; content?: unknown };
}

/** Plain text of a message content (string or blocks); tool calls become "name(args)". */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content as { type?: string; text?: string; name?: string; arguments?: unknown }[]) {
		if (block?.type === "text" && block.text) parts.push(block.text);
		else if (block?.type === "toolCall" && block.name) parts.push(`${block.name}(${JSON.stringify(block.arguments ?? {}).slice(0, 600)})`);
	}
	return parts.join("\n");
}

/** Entries out of the live context, oldest first: everything before the last compaction's firstKeptEntryId, plus
 *  the entries billion-context folded into a compress block (`folded`, see foldedIds). */
export function archivedEntries(branch: readonly Entry[], folded?: ReadonlySet<string>): Entry[] {
	let last = -1;
	for (let i = 0; i < branch.length; i++) if (branch[i].type === "compaction") last = i;
	let cut = 0;
	if (last >= 0) {
		const kept = branch[last].firstKeptEntryId;
		const keptAt = kept ? branch.findIndex((entry) => entry.id === kept) : -1;
		cut = keptAt >= 0 && keptAt < last ? keptAt : last;
	}
	if (!folded?.size) return branch.slice(0, cut);
	return branch.filter((entry, i) => i < cut || (entry.type === "message" && folded.has(String(entry.id))));
}

const foldCache = new Map<string, { mtime: number; ids: Set<string> }>();
/** Entry ids billion-context-pi folded away: the active blocks of its sidecar `<session>.acp.json`. Cached by mtime. */
export function foldedIds(sessionFile: string | undefined): Set<string> {
	if (!sessionFile) return new Set();
	const file = `${sessionFile}.acp.json`;
	try {
		const mtime = statSync(file).mtimeMs;
		const hit = foldCache.get(file);
		if (hit?.mtime === mtime) return hit.ids;
		const state = JSON.parse(readFileSync(file, "utf8")) as { blocks?: { active?: boolean; effectiveMessageIds?: string[] }[] };
		const ids = new Set<string>();
		for (const block of state.blocks ?? []) if (block.active) for (const id of block.effectiveMessageIds ?? []) ids.add(id);
		foldCache.set(file, { mtime, ids });
		return ids;
	} catch {
		return new Set();
	}
}

/** Splits the archive into short chunks, each remembering its entry, role and (for tool results) tool. */
export function chunkArchive(entries: readonly Entry[]): Chunk[] {
	const chunks: Chunk[] = [];
	// A tool result alone says nothing about where it came from: every one of its chunks starts with the call's arguments.
	const calls = new Map<string, string>();
	for (const entry of entries) {
		const content = entry.message?.content;
		if (entry.message?.role !== "assistant" || !Array.isArray(content)) continue;
		for (const block of content as { type?: string; id?: string; arguments?: unknown }[]) {
			if (block?.type === "toolCall" && block.id) calls.set(block.id, JSON.stringify(block.arguments ?? {}).slice(0, 200));
		}
	}
	for (const entry of entries) {
		const message = entry.message;
		if (entry.type !== "message" || !message?.role || message.role === "system") continue;
		const text = contentText(message.content).trim();
		if (!text) continue;
		const label = message.role === "toolResult" ? `tool ${message.toolName ?? "?"}` : message.role;
		const origin = message.role === "toolResult" && message.toolCallId && calls.has(message.toolCallId) ? `<${calls.get(message.toolCallId)}> ` : "";
		for (let at = 0; at < text.length; at += CHUNK_CHARS) {
			chunks.push({ entryId: entry.id ?? "", role: message.role, label, text: origin + text.slice(at, at + CHUNK_CHARS) });
		}
	}
	return chunks;
}

const STOP = new Set(["the", "and", "che", "per", "con", "una", "uno", "del", "della", "dei", "gli", "non", "nel", "sul", "come", "cosa", "quale", "dove"]);

export function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.split(/[^a-z0-9_]+/)
		.filter((word) => word.length >= 2 && !STOP.has(word));
}

/** BM25 over the chunks; at most `k` hits, best first, at most one hit per neighbouring chunk of the same entry. */
export function search(chunks: readonly Chunk[], query: string, k = 4): Hit[] {
	const terms = [...new Set(tokens(query))];
	if (terms.length === 0 || chunks.length === 0) return [];
	const docs = chunks.map((chunk) => tokens(chunk.text));
	const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
	const frequency = new Map<string, number>();
	for (const doc of docs) for (const term of new Set(doc)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
	const scored: Hit[] = [];
	docs.forEach((doc, index) => {
		const counts = new Map<string, number>();
		for (const word of doc) counts.set(word, (counts.get(word) ?? 0) + 1);
		let score = 0;
		let matched = 0;
		for (const term of terms) {
			const tf = counts.get(term) ?? 0;
			if (!tf) continue;
			matched++;
			const df = frequency.get(term) ?? 0;
			const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
			score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / average));
		}
		if (score > 0) scored.push({ ...chunks[index], score, matched });
	});
	scored.sort((a, b) => b.score - a.score);
	const seen = new Set<string>();
	const hits: Hit[] = [];
	for (const hit of scored) {
		const key = `${hit.entryId}:${hit.text.slice(0, 40)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		hits.push(hit);
		if (hits.length >= k) break;
	}
	return hits;
}

/** The whole text of one archived entry (opened by the #id an excerpt showed), capped. */
export function openEntry(entries: readonly Entry[], id: string, limit = 6000): string {
	const wanted = id.replace(/^#/, "");
	const entry = entries.find((candidate) => candidate.id?.startsWith(wanted));
	const text = entry?.message ? contentText(entry.message.content).trim() : "";
	if (!text) return `Voce #${wanted} non trovata nella storia compattata.`;
	return text.length > limit ? `${text.slice(0, limit)}\n[… tagliato, ${text.length - limit} caratteri]` : text;
}

/**
 * A short old user message that shares most of the prompt's words is the same command asked again ("read file X and
 * answer"), not a detail worth recalling: it only adds tokens (measured: 15 of 20 automatic recalls in the long bench).
 */
export function repeatsPrompt(hit: Chunk, prompt: string): boolean {
	if (hit.role !== "user" || hit.text.length > prompt.length * 2 + 200) return false;
	const terms = new Set(tokens(prompt));
	const words = new Set(tokens(hit.text));
	let shared = 0;
	for (const term of terms) if (words.has(term)) shared++;
	return shared >= terms.size * 0.5;
}

/**
 * e5 scores of unrelated text are all close (0.80-0.88), so a fixed cosine floor cannot tell a recall request from an
 * ordinary prompt; how far a chunk stands out from the rest of the archive can (z-score; calibrated on a noid bench
 * session: requests 2.8-6.2, ordinary prompts 2.5-3.3, see eval/ab/REPORT.md).
 */
export const SEM_Z = Number(process.env.PI_ARCHIVE_SEM_Z ?? 4.2);
const SEM_FLOOR = 0.8;

/**
 * Semantic auto recall: the chunks closest in meaning to the prompt, with no words in common needed. `vectors` maps a
 * chunk's text to its embedding (built in the background); chunks without one are skipped.
 */
export function semanticRecall(chunks: readonly Chunk[], vectors: ReadonlyMap<string, Float32Array>, query: Float32Array, prompt: string, minZ = SEM_Z, limit = 1500, skip: ReadonlySet<string> = new Set(), onUsed?: (hit: Hit) => void): string {
	const scored: Hit[] = [];
	let sum = 0;
	for (const chunk of chunks) {
		const vector = vectors.get(chunk.text);
		if (!vector) continue;
		let dot = 0;
		for (let i = 0; i < vector.length; i++) dot += vector[i] * query[i];
		sum += dot;
		scored.push({ ...chunk, score: dot, matched: dot });
	}
	if (scored.length < 20) return "";
	const mean = sum / scored.length;
	const sd = Math.sqrt(scored.reduce((acc, hit) => acc + (hit.score - mean) ** 2, 0) / scored.length);
	if (sd === 0) return "";
	for (const hit of scored) hit.z = (hit.score - mean) / sd;
	const hits = scored.filter((hit) => hit.score >= SEM_FLOOR && !skip.has(hit.entryId) && (hit.score - mean) / sd >= minZ).sort((a, b) => b.score - a.score).filter((hit) => !repeatsPrompt(hit, prompt)).slice(0, 3);
	if (hits.length === 0) return "";
	for (const hit of hits) onUsed?.(hit);
	return `${HEADER()}\n${renderHits(hits, limit)}`;
}

/** Every embedded chunk ranked by similarity, with its z-score (what the /archive test tab shows; nothing is filtered). */
export function rankSemantic(chunks: readonly Chunk[], vectors: ReadonlyMap<string, Float32Array>, query: Float32Array, limit = 20): Hit[] {
	const scored: Hit[] = [];
	let sum = 0;
	for (const chunk of chunks) {
		const vector = vectors.get(chunk.text);
		if (!vector) continue;
		let dot = 0;
		for (let i = 0; i < vector.length; i++) dot += vector[i] * query[i];
		sum += dot;
		scored.push({ ...chunk, score: dot, matched: dot });
	}
	if (scored.length === 0) return [];
	const mean = sum / scored.length;
	const sd = Math.sqrt(scored.reduce((acc, hit) => acc + (hit.score - mean) ** 2, 0) / scored.length) || 1;
	for (const hit of scored) hit.z = (hit.score - mean) / sd;
	return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** What the /archive view shows: the archived entries and the recalls that rode along with prompts. */
export interface ArchiveOverview {
	entries: { id: string; role: string; label: string; chars: number; preview: string; injected: number }[];
	injections: { at: string; prompt: string; method: string; hits: { id: string; label: string; z?: number }[]; text: string }[];
	compactions: number;
}

export function archiveOverview(branch: readonly (Entry & { customType?: string; content?: unknown; details?: unknown; timestamp?: string })[], folded?: ReadonlySet<string>): ArchiveOverview {
	const archived = archivedEntries(branch, folded);
	const injections: ArchiveOverview["injections"] = [];
	let lastUser = "";
	for (const entry of branch) {
		if (entry.type === "message" && entry.message?.role === "user") lastUser = contentText(entry.message.content);
		if (entry.type !== "custom_message" || entry.customType !== "archive-recall") continue;
		const details = (entry.details ?? {}) as { prompt?: string; method?: string; hits?: { id: string; label: string; z?: number }[] };
		injections.push({ at: String(entry.timestamp ?? ""), prompt: details.prompt ?? lastUser, method: details.method ?? "?", hits: details.hits ?? [], text: contentText(entry.content) });
	}
	const counts = new Map<string, number>();
	for (const injection of injections) for (const hit of injection.hits) counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1);
	return {
		entries: archived.map((entry) => {
			const text = contentText(entry.message?.content);
			const id = String(entry.id ?? "");
			const label = entry.message?.toolName ? `tool ${entry.message.toolName}` : String(entry.message?.role ?? entry.type ?? "?");
			return { id, role: String(entry.message?.role ?? entry.type ?? "?"), label, chars: text.length, preview: text.replace(/\s+/g, " ").trim().slice(0, 160), injected: counts.get(id.slice(0, 8)) ?? 0 };
		}),
		injections,
		compactions: branch.filter((entry) => entry.type === "compaction").length,
	};
}

/** Plain-text summary of the archive for clients without the full-screen view. */
export function archiveText(overview: ArchiveOverview): string {
	const lines = [`Archivio: ${overview.entries.length} voci, ${overview.compactions} compattazioni, ${overview.injections.length} iniezioni`, "", "Iniezioni:"];
	for (const injection of overview.injections.slice(-10)) lines.push(`  ${injection.method === "semantic" ? "sem" : "lex"} ${injection.hits.map((hit) => `#${hit.id}`).join(" ") || "-"} ← ${injection.prompt.replace(/\s+/g, " ").slice(0, 70)}`);
	if (!overview.injections.length) lines.push("  nessuna");
	lines.push("", "Voci (/archive <id> le apre, /archive <testo> cerca):");
	for (const entry of overview.entries.slice(-40)) lines.push(`  #${entry.id.slice(0, 8)} ${entry.label} ${entry.chars}c${entry.injected ? ` ×${entry.injected}` : ""}  ${entry.preview.slice(0, 80)}`);
	return lines.join("\n");
}

/** Excerpts worth adding to a request unasked: several query terms in the same chunk, short output. */
/** Header of an injection; the tool is only named when it can be called. */
const HEADER = () => (process.env.PI_ARCHIVE_TOOL !== "1" ? "Dalla storia compattata (dettagli esatti):" : "Dalla storia compattata (dettagli esatti; apri una voce intera con richiama id):");

export function autoRecall(chunks: readonly Chunk[], prompt: string, limit = 1500, onUsed?: (hit: Hit) => void): string {
	const terms = [...new Set(tokens(prompt))];
	if (terms.length < 3) return "";
	// Identifiers (a term with a digit: b02, L33, 48213) that exist in the archive decide: a chunk must hold all of them.
	// Filler words ("quanto", "solo", "file") match everything and would dilute any share.
	const own = chunks.map((chunk) => new Set(tokens(chunk.text)));
	const keys = terms.filter((term) => /\d/.test(term) && own.some((doc) => doc.has(term)));
	let hits: Hit[];
	if (keys.length >= 2) {
		hits = search(chunks, keys.join(" "), 6).filter((hit) => !repeatsPrompt(hit, prompt)).filter((hit) => { const words = new Set(tokens(hit.text)); return keys.every((key) => words.has(key)); }).slice(0, 3);
		if (hits.length === 0) return keyExcerpts(chunks, own, keys, prompt, limit, onUsed);
	} else if (names(terms, own, prompt, chunks).length >= 2) {
		return keyExcerpts(chunks, own, names(terms, own, prompt, chunks), prompt, limit, onUsed);
	} else {
		const need = Math.max(MIN_MATCHED, Math.ceil(terms.length * MIN_SHARE));
		hits = search(chunks, prompt, 3).filter((hit) => hit.matched >= need && !repeatsPrompt(hit, prompt));
	}
	if (hits.length === 0) return "";
	for (const hit of hits) onUsed?.(hit);
	return `${HEADER()}\n${renderHits(hits, limit)}`;
}

/** Exact lines for the code identifiers the prompt names and the archive holds; "" otherwise. */
export function keyRecall(chunks: readonly Chunk[], prompt: string, limit = 1500, onUsed?: (hit: Hit) => void): string {
	const own = chunks.map((chunk) => new Set(tokens(chunk.text)));
	const keys = names([...new Set(tokens(prompt))], own, prompt, chunks);
	// A single name only brings back its definition (cheap, rarely wrong); a mere use of it is not worth a turn's tokens.
	return keys.length === 0 ? "" : keyExcerpts(chunks, own, keys, prompt, limit, onUsed, keys.length === 1);
}

// Path segments too common to name a file by ("src", "extensions") are not taken as a reference to it.
const GENERIC_SEGMENTS = new Set(["src", "lib", "dist", "test", "tests", "index", "main", "extensions", "users", "home", "documents", "projects", "tmp", "private", "node_modules"]);
const TOP_CONST = /^(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=.*$/gm;

/**
 * Top-level constants of the files read earlier that a question refers to by name ("l'estensione vault", "il pannello
 * di pi-ui") without any identifier: a one-line summary keeps what a file does, rarely its values. A part that names an
 * identifier or a file path is left to keyRecall (and is usually a request to read the file again).
 * `source` is every earlier read, not only the archive: billion-context's emergency truncation keeps a live file's first
 * and last ~2000 characters, so a constant in the middle is gone from the context while its read is still live.
 * Lazy, so the reads are only chunked when the prompt describes something.
 */
export function constRecall(source: readonly Chunk[] | (() => readonly Chunk[]), prompt: string, limit = 600, onUsed?: (hit: Hit) => void): string {
	const parts = prompt.split(/(?:^|\s)\d{1,2}[).]\s|\n+|;/).filter((part) => !/[A-Z][A-Z0-9]*_[A-Z0-9_]+|\d|\/|\b\w+\.[a-z]{1,4}\b/.test(part));
	const words = new Set(parts.flatMap((part) => part.toLowerCase().match(/[a-z0-9][a-z0-9-]*[a-z0-9]/g) ?? []).filter((word) => word.length >= 3 && !STOP.has(word)));
	if (words.size === 0) return "";
	const chunks = typeof source === "function" ? source() : source;
	// A read file is rebuilt from its chunks: a constant may straddle two of them.
	const files = new Map<string, { path: string; text: string; first: Chunk }>();
	for (const chunk of chunks) {
		if (chunk.role !== "toolResult") continue;
		const origin = /^<(\{.*?\})> /.exec(chunk.text);
		const path = origin ? /"path":"([^"]+)"/.exec(origin[1])?.[1] : undefined;
		if (!path) continue;
		const key = `${chunk.entryId}\u0000${path}`;
		const file = files.get(key) ?? { path, text: "", first: chunk };
		file.text += chunk.text.slice(origin![0].length);
		files.set(key, file);
	}
	const lines: string[] = [];
	const seen = new Set<string>();
	let used = 0;
	for (const file of files.values()) {
		const segments = file.path.toLowerCase().split("/").map((segment) => segment.replace(/\.[a-z0-9]+$/, "")).filter((segment) => !GENERIC_SEGMENTS.has(segment));
		if (!segments.some((segment) => words.has(segment))) continue;
		const short = file.path.split("/").slice(-2).join("/");
		let took = false;
		for (const line of file.text.match(TOP_CONST) ?? []) {
			const item = `${short}: ${line.trim().slice(0, 140)}`;
			if (seen.has(item) || used + item.length > limit) continue;
			seen.add(item);
			lines.push(item);
			used += item.length + 1;
			took = true;
		}
		if (took) onUsed?.({ ...file.first, score: 0, matched: 0 });
	}
	return lines.length ? `${HEADER()}\n${lines.join("\n")}` : "";
}

const FACT_STOP = new Set([...STOP, "il", "lo", "la", "le", "di", "da", "in", "su", "al", "ai", "delle", "dello", "degli", "sulla", "sullo", "nella", "nello", "scrivi", "rispondi", "solo", "valori", "esatti", "so", "se"]);
// Five-letter stems: "contato" finds "conta", "deciso" finds "decisione".
const stems = (text: string) => tokens(text).filter((word) => !FACT_STOP.has(word)).map((word) => word.slice(0, 5));

/**
 * Facts the user stated, and what came back for an old request ("conta con bash…" → 14403), for each part of the prompt
 * ("1) il ticket 2) …") whose words an old user message holds: identifiers miss them, they have none. A part counts
 * only if the matched words carry most of its weight (idf), so "FADE_DAYS in memory.ts" does not pull "read memory.ts".
 */
export function factRecall(chunks: readonly Chunk[], prompt: string, limit = 900, onUsed?: (hit: Hit) => void): string {
	const parts = prompt.split(/(?:^|\s)\d{1,2}[).]\s|\n+|;/).map((part) => stems(part)).filter((part) => part.length > 0);
	if (parts.length === 0) return "";
	const own = chunks.map((chunk) => new Set(stems(chunk.text)));
	const idf = (stem: string) => Math.log(1 + chunks.length / (1 + own.filter((doc) => doc.has(stem)).length));
	const lines: string[] = [];
	const taken = new Set<number>();
	let used = 0;
	for (const part of parts) {
		const total = part.reduce((sum, stem) => sum + idf(stem), 0);
		let best = -1;
		let bestScore = 0;
		chunks.forEach((chunk, index) => {
			if (chunk.role !== "user" || chunk.text.length > 600 || repeatsPrompt(chunk as Hit, prompt)) return;
			const score = part.filter((stem) => own[index].has(stem)).reduce((sum, stem) => sum + idf(stem), 0);
			if (score > bestScore) [best, bestScore] = [index, score];
		});
		if (best < 0 || taken.has(best) || bestScore < total * 0.6) continue;
		taken.add(best);
		// What followed the message until the next user turn: a tool output and the last non-trivial reply.
		const after: string[] = [];
		for (let at = best + 1; at < chunks.length && chunks[at].role !== "user"; at++) {
			const text = chunks[at].text.replace(/<!--suggerimenti-->[\s\S]*/, "").replace(/\s+/g, " ").trim();
			if (chunks[at].role === "toolResult") after.push(text.slice(0, 160));
			else if (text.length > 3 && text.length <= 300) after.push(text);
		}
		const chunk = chunks[best];
		const line = `[#${chunk.entryId.slice(0, 8)} user] ${chunk.text.replace(/\s+/g, " ").trim()}${after.length ? ` → ${after.slice(-2).join(" | ")}` : ""}`;
		if (used + line.length > limit) break;
		lines.push(line);
		used += line.length;
		onUsed?.({ ...chunk, score: bestScore, matched: 1 });
	}
	return lines.length ? `${HEADER()}\n${lines.join("\n")}` : "";
}

/** End of the statement that starts at `from` (after ";" or ","), at least 100 and at most 400 chars on. */
const statementEnd = (flat: string, from: number) => {
	const stop = flat.slice(from + 100, from + 400).search(/[;,]/);
	return stop < 0 ? from + 400 : from + 100 + stop + 1;
};

/** Code identifiers of the prompt (snake_case, or an ALL-CAPS word as written) that some archived chunk holds. */
const names = (terms: readonly string[], own: readonly Set<string>[], prompt: string, chunks: readonly Chunk[]) => {
	// An ALL-CAPS word counts only if the archive holds it in capitals too (a constant, not a shouted word).
	const caps = new Set((prompt.match(/\b[A-Z][A-Z0-9_]{4,}\b/g) ?? []).filter((word) => chunks.some((chunk) => chunk.text.includes(word))).map((word) => word.toLowerCase()));
	return terms.filter((term) => (term.includes("_") || caps.has(term)) && /[a-z]/.test(term) && own.some((doc) => doc.has(term)));
};

/** One short window around each key, from the best chunk that holds it: the exact line comes back, not the whole chunk. */
function keyExcerpts(chunks: readonly Chunk[], _own: readonly Set<string>[], keys: readonly string[], prompt: string, limit: number, onUsed?: (hit: Hit) => void, definitionOnly = false): string {
	const lines: string[] = [];
	let used = 0;
	for (const key of keys.slice(0, 10)) {
		// An excerpt already sent for another key may hold this one too.
		if (lines.some((line) => line.toLowerCase().includes(key))) continue;
		// Prefer the definition (KEY = …, KEY: …) over a mere use of the name.
		const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const definition = new RegExp(`\\b${escaped}\\b\\s*(?::[^=\\n]{0,40})?[=:]`, "i");
		const candidates = search(chunks, key, 12).filter((h) => tokens(h.text).includes(key) && !repeatsPrompt(h, prompt));
		const defined = chunks.find((c) => definition.test(c.text) && !repeatsPrompt(c as Hit, prompt));
		const hit = (defined ? { ...defined, score: 0, matched: 1 } : undefined) ?? (definitionOnly ? undefined : candidates[0]);
		if (!hit) continue;
		// Chunks of an entry are consecutive and do not overlap: glue the next one so a value cut at the edge comes back whole.
		const index = chunks.findIndex((chunk) => chunk.entryId === hit.entryId && chunk.text === hit.text);
		const next = chunks[index + 1];
		const origin = hit.text.startsWith("<") ? hit.text.slice(0, hit.text.indexOf("> ") + 2) : "";
		const tail = next && next.entryId === hit.entryId ? next.text.slice(origin && next.text.startsWith(origin) ? origin.length : 0, 400) : "";
		const flat = (hit.text + tail).replace(/\s+/g, " ");
		const found = definition.exec(flat);
		const at = found ? found.index : flat.toLowerCase().indexOf(key);
		if (at < 0) continue;
		const line = `[#${hit.entryId.slice(0, 8)} ${hit.label}] …${flat.slice(Math.max(0, at - 40), statementEnd(flat, at + key.length)).trim()}…`;
		if (used + line.length > limit) break;
		lines.push(line);
		used += line.length;
		onUsed?.(hit);
	}
	return lines.length ? `${HEADER()}\n${lines.join("\n")}` : "";
}

export function renderHits(hits: readonly Hit[], limit = OUTPUT_CHARS): string {
	if (hits.length === 0) return "Nessun risultato nella storia compattata.";
	const lines: string[] = [];
	let used = 0;
	for (const hit of hits) {
		const line = `[#${hit.entryId.slice(0, 8)} ${hit.label}] ${hit.text.replace(/\s+/g, " ").trim()}`;
		if (used + line.length > limit && lines.length > 0) break;
		lines.push(line);
		used += line.length;
	}
	return lines.join("\n");
}

const searchChunks = search;

export default function (pi: ExtensionAPI) {
	if (process.env.PI_ARCHIVE === "0") return;
	let registered = false;
	// Archive = what a Pi compaction left out plus what billion-context folded into compress blocks.
	const archived = (ctx: ExtensionContext) => archivedEntries(ctx.sessionManager.getBranch() as Entry[], foldedIds(ctx.sessionManager.getSessionFile?.()));

	/** Safe against a stale pi after a reload. */
	const safely = (action: () => void) => {
		try {
			action();
		} catch (error) {
			if (!/stale/i.test(String((error as Error)?.message))) throw error;
		}
	};

	const register = () => {
		if (registered) return;
		registered = true;
		pi.registerTool({
			name: "richiama",
			label: "Richiama",
			description: "Search the earlier part of this session that was compacted away (exact details: commands, numbers, paths, decisions). Returns short excerpts.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "Words likely in the original text" },
					id: { type: "string", description: "Open one whole excerpt by its #id instead of searching" },
					k: { type: "number", description: "Excerpts to return (default 4)" },
				},
				required: [],
			} as never,
			async execute(_id, params, _signal, _update, ctx) {
				const { query = "", k, id } = params as { query?: string; k?: number; id?: string };
				const entries = archived(ctx);
				if (id) return { content: [{ type: "text" as const, text: openEntry(entries, id) }], details: undefined };
				const chunks = chunkArchive(entries);
				const text = renderHits(search(chunks, query, Math.min(Math.max(Math.round(k ?? 4), 1), 8)));
				return { content: [{ type: "text" as const, text }], details: undefined };
			},
		});
	};

	// The tool joins the request only once something was compacted (the cache is rewritten then anyway).
	const turnOn = (ctx: ExtensionContext) =>
		safely(() => {
			// No tool unless PI_ARCHIVE_TOOL=1: turning it on rewrites the cached prefix (bench §17) and the model never called it.
			if (process.env.PI_ARCHIVE_TOOL !== "1") return;
			// PI_ARCHIVE_EARLY=1 (bench arm D): tool on from the first request, so turning it on never rewrites the cache.
			if (process.env.PI_ARCHIVE_EARLY !== "1" && archived(ctx).length === 0) return;
			register();
			const active = pi.getActiveTools();
			if (!active.includes("richiama")) pi.setActiveTools([...active, "richiama"]);
		});
	// The model should not have to remember the tool: when the request shares several terms with something compacted
	// away, the best excerpts ride along as a message (appended after the prefix, so the cache is untouched).
	// Semantic index: embeddings of the archived chunks, built in the background (the local model loads off the main
	// thread); until it is ready the lexical recall alone applies.
	type Embedder = import("../pi-memory/src/embed.ts").Embedder & { ready?: boolean; start?: () => Promise<boolean> };
	let embedder: Embedder | undefined;
	const vectors = new Map<string, Float32Array>();
	// Entries already injected: they sit in the live context now, so none of their chunks is sent twice (also keeps one
	// generic chunk that is close to every prompt from riding along each turn).
	const injected = new Set<string>();
	let indexing = false;
	const buildIndex = (ctx: ExtensionContext) => {
		if (process.env.PI_ARCHIVE_SEM === "0" || indexing) return;
		indexing = true;
		void (async () => {
			try {
				const chunks = chunkArchive(archived(ctx));
				if (chunks.length === 0) return;
				if (!embedder) {
					const { sharedEmbedder, MODELS } = await import("../pi-memory/src/embed.ts");
					embedder = sharedEmbedder(MODELS.e5);
				}
				if (!(await embedder.start?.())) return;
				const missing = chunks.filter((chunk) => !vectors.has(chunk.text));
				for (let i = 0; i < missing.length; i += 16) {
					const batch = missing.slice(i, i + 16);
					const out = await embedder.embed(batch.map((chunk) => chunk.text.slice(0, 900)), "passage");
					batch.forEach((chunk, j) => vectors.set(chunk.text, out[j]));
				}
			} catch {
				/* lexical recall keeps working */
			} finally {
				indexing = false;
			}
		})();
	};
	pi.on("before_agent_start", async (event, ctx) => {
		if (process.env.PI_ARCHIVE_AUTO === "0") return undefined;
		try {
			const chunks = chunkArchive(archived(ctx));
			let text = "";
			let method = "semantic";
			const used: { id: string; label: string; z?: number }[] = [];
			const note = (hit: Hit) => {
				injected.add(hit.entryId);
				used.push({ id: hit.entryId.slice(0, 8), label: hit.label, z: hit.z });
			};
			// Named identifiers first: their exact lines beat any semantic neighbour.
			// Only a short window is sent, not the entry: it stays recallable for other keys (not marked injected).
			text = keyRecall(chunks, event.prompt, 1500, (hit) => used.push({ id: hit.entryId.slice(0, 8), label: hit.label }));
			if (text) method = "keys";
			// Stated facts ride along: a quiz names constants and user facts at once.
			const facts = factRecall(chunks, event.prompt, 900, (hit) => used.push({ id: hit.entryId.slice(0, 8), label: "fact" }));
			if (facts) {
				text = text ? `${text}\n${facts.slice(facts.indexOf("\n") + 1)}` : facts;
				method = method === "keys" ? "keys+facts" : "facts";
			}
			// Files named by description ("l'estensione vault"): their constants, which summaries drop.
			const branch = ctx.sessionManager.getBranch() as Entry[];
			const reads = () => chunkArchive(branch.filter((entry) => entry.message?.role === "assistant" || (entry.message?.role === "toolResult" && entry.message.toolName === "read")));
			const consts = constRecall(reads, event.prompt, 600, (hit) => used.push({ id: hit.entryId.slice(0, 8), label: "const" }));
			if (consts) {
				text = text ? `${text}\n${consts.slice(consts.indexOf("\n") + 1)}` : consts;
				method = method === "semantic" ? "consts" : `${method}+consts`;
			}
			if (!text && embedder?.ready && vectors.size > 0) {
				try {
					const [query] = await embedder.embed([event.prompt.slice(0, 600)], "query");
					text = semanticRecall(chunks, vectors, query, event.prompt, SEM_Z, 1500, injected, note);
				} catch {
					/* fall through to lexical */
				}
			}
			if (!text) {
				method = "lexical";
				text = autoRecall(chunks.filter((chunk) => !injected.has(chunk.entryId)), event.prompt, 1500, note);
			}
			return text ? { message: { customType: "archive-recall", content: text, display: false, details: { prompt: event.prompt.slice(0, 300), method, hits: used } } } : undefined;
		} catch {
			return undefined;
		}
	});
	pi.registerCommand("archive", {
		description: "Apri l'archivio della storia compattata: iniezioni, voci e prova di recupero",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" && ctx.mode !== "rpc") return ctx.ui.notify("/archive serve il terminale interattivo.", "warning");
			const branch = ctx.sessionManager.getBranch() as Entry[];
			const folded = foldedIds(ctx.sessionManager.getSessionFile?.());
			const overview = archiveOverview(branch, folded);
			if (overview.entries.length === 0) return ctx.ui.notify("Archivio vuoto: nulla \u00e8 stato ancora compattato in questa sessione.", "info");
			const chunks = chunkArchive(archivedEntries(branch, folded));
			if (ctx.mode === "rpc") {
				// No custom views over RPC: the client shows a multi-line notification in a pager.
				const arg = _args.trim();
				if (!arg) return ctx.ui.notify(archiveText(overview), "info");
				if (/^[0-9a-f]{6,}$/i.test(arg)) return ctx.ui.notify(openEntry(archivedEntries(branch, folded), arg), "info");
				const hits = embedder?.ready && vectors.size > 0 ? rankSemantic(chunks, vectors, (await embedder.embed([arg.slice(0, 600)], "query"))[0], 8) : searchChunks(chunks, arg, 8);
				return ctx.ui.notify(hits.length ? hits.map((hit) => `#${hit.entryId.slice(0, 8)} ${hit.label}${hit.z !== undefined ? ` z${hit.z.toFixed(1)}` : ""}\n${hit.text}`).join("\n\n") : "Nessun risultato.", "info");
			}
			const { ArchiveView } = await import("../pi-ui/src/archive-view.ts");
			const search = async (query: string) => {
				if (embedder?.ready && vectors.size > 0) {
					const [vector] = await embedder.embed([query.slice(0, 600)], "query");
					return { method: "semantic" as const, hits: rankSemantic(chunks, vectors, vector, 12) };
				}
				return { method: "lexical" as const, hits: searchChunks(chunks, query, 12) };
			};
			const status = { chunks: chunks.length, vectors: vectors.size, semantic: Boolean(embedder?.ready), threshold: SEM_Z };
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) =>
					new ArchiveView({ fg: (role, text) => theme.fg(role, text), bold: (text) => theme.bold(text) }, overview, status, search, (id) => openEntry(archivedEntries(branch, folded), id), done, () => tui.requestRender(), () => tui.terminal.rows),
				{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
			);
		},
	});
	// Short status for side panels: archived entries and how many injections rode along.
	const publish = (ctx: ExtensionContext) =>
		safely(() => {
			if (!ctx.hasUI) return;
			const overview = archiveOverview(ctx.sessionManager.getBranch() as Entry[], foldedIds(ctx.sessionManager.getSessionFile?.()));
			ctx.ui.setStatus("archivio", overview.entries.length ? `${overview.entries.length} voci · ${overview.injections.length} richiami` : undefined);
		});
	pi.on("session_start", (_event, ctx) => { turnOn(ctx); buildIndex(ctx); publish(ctx); });
	pi.on("session_compact", (_event, ctx) => { turnOn(ctx); buildIndex(ctx); publish(ctx); });
	// billion-context cancels Pi's compaction and folds ranges with its `compress` tool instead: index those too.
	pi.on("tool_result", (event, ctx) => {
		if ((event as { toolName?: string }).toolName === "compress" && !(event as { isError?: boolean }).isError) buildIndex(ctx);
	});
	pi.on("agent_end", (_event, ctx) => publish(ctx));
}
