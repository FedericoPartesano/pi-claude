/**
 * Archive of the compacted history ("small live context, big archive").
 *
 * A compaction keeps the live context small but drops the details. They are not lost: Pi's session file still holds
 * every entry. After the first compaction this extension turns on one tool, `richiama`, that searches what the
 * compaction left out and returns a few short excerpts. Excerpts arrive as a tool result (appended), so the cached
 * prefix is never rewritten. No compaction yet → no tool, no prompt text, zero fixed cost. Search is lexical (BM25),
 * so there is no model download and no dependency.
 */
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
}

const CHUNK_CHARS = 900;
const OUTPUT_CHARS = 3500;
// Auto recall fires only when a chunk shares enough of the request's terms (measured: 2 terms fired on 75% of prompts).
const MIN_MATCHED = Number(process.env.PI_ARCHIVE_MIN ?? 4);
const MIN_SHARE = Number(process.env.PI_ARCHIVE_SHARE ?? 0.4);

interface Entry {
	type?: string;
	id?: string;
	firstKeptEntryId?: string;
	message?: { role?: string; toolName?: string; content?: unknown };
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

/** Entries the last compaction left out of the live context (everything before firstKeptEntryId), oldest first. */
export function archivedEntries(branch: readonly Entry[]): Entry[] {
	let last = -1;
	for (let i = 0; i < branch.length; i++) if (branch[i].type === "compaction") last = i;
	if (last < 0) return [];
	const kept = branch[last].firstKeptEntryId;
	const keptAt = kept ? branch.findIndex((entry) => entry.id === kept) : -1;
	return branch.slice(0, keptAt >= 0 && keptAt < last ? keptAt : last);
}

/** Splits the archive into short chunks, each remembering its entry, role and (for tool results) tool. */
export function chunkArchive(entries: readonly Entry[]): Chunk[] {
	const chunks: Chunk[] = [];
	for (const entry of entries) {
		const message = entry.message;
		if (entry.type !== "message" || !message?.role || message.role === "system") continue;
		const text = contentText(message.content).trim();
		if (!text) continue;
		const label = message.role === "toolResult" ? `tool ${message.toolName ?? "?"}` : message.role;
		for (let at = 0; at < text.length; at += CHUNK_CHARS) {
			chunks.push({ entryId: entry.id ?? "", role: message.role, label, text: text.slice(at, at + CHUNK_CHARS) });
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

/** Excerpts worth adding to a request unasked: several query terms in the same chunk, short output. */
export function autoRecall(chunks: readonly Chunk[], prompt: string, limit = 1500): string {
	if (tokens(prompt).length < 3) return "";
	const need = Math.max(MIN_MATCHED, Math.ceil(new Set(tokens(prompt)).size * MIN_SHARE));
	const hits = search(chunks, prompt, 3).filter((hit) => hit.matched >= need);
	if (hits.length === 0) return "";
	return `Dalla storia compattata (dettagli esatti; apri una voce intera con richiama id):\n${renderHits(hits, limit)}`;
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

export default function (pi: ExtensionAPI) {
	if (process.env.PI_ARCHIVE === "0") return;
	let registered = false;

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
				const entries = archivedEntries(ctx.sessionManager.getBranch() as Entry[]);
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
			if (archivedEntries(ctx.sessionManager.getBranch() as Entry[]).length === 0) return;
			register();
			const active = pi.getActiveTools();
			if (!active.includes("richiama")) pi.setActiveTools([...active, "richiama"]);
		});
	// The model should not have to remember the tool: when the request shares several terms with something compacted
	// away, the best excerpts ride along as a message (appended after the prefix, so the cache is untouched).
	pi.on("before_agent_start", (event, ctx) => {
		if (process.env.PI_ARCHIVE_AUTO === "0") return undefined;
		try {
			const chunks = chunkArchive(archivedEntries(ctx.sessionManager.getBranch() as Entry[]));
			const text = autoRecall(chunks, event.prompt);
			return text ? { message: { customType: "archive-recall", content: text, display: false } } : undefined;
		} catch {
			return undefined;
		}
	});
	pi.on("session_start", (_event, ctx) => turnOn(ctx));
	pi.on("session_compact", (_event, ctx) => turnOn(ctx));
}
