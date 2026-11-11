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

export function archiveOverview(branch: readonly (Entry & { customType?: string; content?: unknown; details?: unknown; timestamp?: string })[]): ArchiveOverview {
	const archived = archivedEntries(branch);
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
	} else {
		const need = Math.max(MIN_MATCHED, Math.ceil(terms.length * MIN_SHARE));
		hits = search(chunks, prompt, 3).filter((hit) => hit.matched >= need && !repeatsPrompt(hit, prompt));
	}
	if (hits.length === 0) return "";
	for (const hit of hits) onUsed?.(hit);
	return `${HEADER()}\n${renderHits(hits, limit)}`;
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
			// No tool unless PI_ARCHIVE_TOOL=1: turning it on rewrites the cached prefix (bench §17) and the model never called it.
			if (process.env.PI_ARCHIVE_TOOL !== "1") return;
			// PI_ARCHIVE_EARLY=1 (bench arm D): tool on from the first request, so turning it on never rewrites the cache.
			if (process.env.PI_ARCHIVE_EARLY !== "1" && archivedEntries(ctx.sessionManager.getBranch() as Entry[]).length === 0) return;
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
				const chunks = chunkArchive(archivedEntries(ctx.sessionManager.getBranch() as Entry[]));
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
			const chunks = chunkArchive(archivedEntries(ctx.sessionManager.getBranch() as Entry[]));
			let text = "";
			let method = "semantic";
			const used: { id: string; label: string; z?: number }[] = [];
			const note = (hit: Hit) => {
				injected.add(hit.entryId);
				used.push({ id: hit.entryId.slice(0, 8), label: hit.label, z: hit.z });
			};
			if (embedder?.ready && vectors.size > 0) {
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
			const overview = archiveOverview(branch);
			if (overview.entries.length === 0) return ctx.ui.notify("Archivio vuoto: nulla \u00e8 stato ancora compattato in questa sessione.", "info");
			const chunks = chunkArchive(archivedEntries(branch));
			if (ctx.mode === "rpc") {
				// No custom views over RPC: the client shows a multi-line notification in a pager.
				const arg = _args.trim();
				if (!arg) return ctx.ui.notify(archiveText(overview), "info");
				if (/^[0-9a-f]{6,}$/i.test(arg)) return ctx.ui.notify(openEntry(archivedEntries(branch), arg), "info");
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
					new ArchiveView({ fg: (role, text) => theme.fg(role, text), bold: (text) => theme.bold(text) }, overview, status, search, (id) => openEntry(archivedEntries(branch), id), done, () => tui.requestRender(), () => tui.terminal.rows),
				{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
			);
		},
	});
	// Short status for side panels: archived entries and how many injections rode along.
	const publish = (ctx: ExtensionContext) =>
		safely(() => {
			if (!ctx.hasUI) return;
			const overview = archiveOverview(ctx.sessionManager.getBranch() as Entry[]);
			ctx.ui.setStatus("archivio", overview.entries.length ? `${overview.entries.length} voci · ${overview.injections.length} richiami` : undefined);
		});
	pi.on("session_start", (_event, ctx) => { turnOn(ctx); buildIndex(ctx); publish(ctx); });
	pi.on("session_compact", (_event, ctx) => { turnOn(ctx); buildIndex(ctx); publish(ctx); });
	pi.on("agent_end", (_event, ctx) => publish(ctx));
}
