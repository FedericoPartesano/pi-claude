/**
 * Memory core: pure functions behind /dream and /ricorda (no Pi imports, tested with node --test).
 *
 * Human-memory model: sessions are short-term memory; /dream consolidates them into memory.md (long-term, always in
 * context, capped) and memory-archive.md (episodes, superseded and faded memories, recalled on demand).
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export const MEMORY_TYPES = ["correzione", "preferenza", "decisione", "fatto", "episodio"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryEntry {
	/** Stable id in the deep store (absent in the capped files). */
	id?: string;
	/** Entities (paths, identifiers, concepts) used by deep recall for associations. */
	entities?: string[];
	type: MemoryType | string;
	text: string;
	pinned: boolean;
	confirmations: number;
	/** Last confirmation, YYYY-MM-DD ("" for hand-written lines without metadata). */
	last: string;
	archived?: string;
	reason?: string;
	/** Ids of related memories (deep store), from the "links" /dream proposes. */
	links?: string[];
	/** One short line for the cues (deep store). */
	gist?: string;
	/** personale = valid in every project (moved to the global store). */
	level?: "progetto" | "personale";
}

/** Graph and cue fields /dream may propose for a memory (links are m<n> ids of the current memory). */
export interface Extras {
	links?: string[];
	gist?: string;
	level?: "progetto" | "personale";
}

export interface Proposal {
	add: ({ type: MemoryType; text: string; entities?: string[] } & Extras)[];
	reinforce: string[];
	merge: ({ ids: string[]; text: string; type?: MemoryType; entities?: string[] } & Extras)[];
	update: ({ id: string; text: string; type?: MemoryType; entities?: string[] } & Extras)[];
	forget: { id: string; reason?: string }[];
	/** The project overview, rewritten by /dream (deep mode): always in the system prompt, ≤ 1200 chars. */
	quadro?: string;
}

const HEADERS = {
	memory: "# Memoria di Pi\n<!-- gestita da /dream: modificabile a mano -->\n",
	archive: "# Archivio della memoria di Pi\n<!-- ricordi superati, sbiaditi o episodi: non in contesto, cercali con /ricorda -->\n",
};

// ---- Format ---------------------------------------------------------------------------------------------------

export function parseMemory(text: string): MemoryEntry[] {
	const entries: MemoryEntry[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trimEnd();
		const match = /^- \[([^\]]+)\] (.+)$/.exec(line);
		if (!match) continue;
		let body = match[2];
		const entry: MemoryEntry = { type: match[1], text: "", pinned: false, confirmations: 1, last: "" };
		const metaStart = body.lastIndexOf(" (conferme: ");
		if (metaStart !== -1 && body.endsWith(")")) {
			const meta = body.slice(metaStart + 2, -1).split(" · ");
			body = body.slice(0, metaStart);
			for (let index = 0; index < meta.length; index++) {
				const [key, ...rest] = meta[index].split(": ");
				const value = rest.join(": ");
				if (key === "conferme") entry.confirmations = Number(value) || 1;
				else if (key === "ultima") entry.last = value;
				else if (key === "archiviato") entry.archived = value;
				else if (key === "motivo") {
					entry.reason = [value, ...meta.slice(index + 1)].join(" · ");
					break;
				}
			}
		}
		if (body.endsWith(" 📌")) {
			entry.pinned = true;
			body = body.slice(0, -" 📌".length);
		}
		entry.text = body.trim();
		entries.push(entry);
	}
	return entries;
}

function renderLine(entry: MemoryEntry): string {
	const meta = [`conferme: ${entry.confirmations}`, `ultima: ${entry.last}`];
	if (entry.archived) meta.push(`archiviato: ${entry.archived}`);
	if (entry.reason) meta.push(`motivo: ${entry.reason}`);
	return `- [${entry.type}] ${entry.text}${entry.pinned ? " 📌" : ""} (${meta.join(" · ")})`;
}

export function renderMemory(entries: MemoryEntry[], kind: "memory" | "archive" = "memory"): string {
	return HEADERS[kind] + entries.map((entry) => `${renderLine(entry)}\n`).join("");
}

/** The compact line sent to the model in context: no metadata, it only costs tokens. */
export const contextLine = (entry: MemoryEntry) => `- [${entry.type}] ${entry.text}`;

// ---- Consolidation ---------------------------------------------------------------------------------------------

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const idOf = (index: number) => `m${index + 1}`;

const withEntities = (entities: string[] | undefined) => (entities && entities.length > 0 ? { entities } : {});

/** Applies an approved proposal. Deterministic: ids are positions in `memory` (m1 = first entry). */
export function applyProposal(memory: MemoryEntry[], archive: MemoryEntry[], proposal: Proposal, today: string) {
	const counts = { added: 0, reinforced: 0, merged: 0, updated: 0, forgotten: 0 };
	const slots: (MemoryEntry | undefined)[] = memory.map((entry) => ({ ...entry }));
	const newArchive = archive.map((entry) => ({ ...entry }));
	const index = (id: string) => Number(id.slice(1)) - 1;
	const touched = new Set<number>();
	/** Extras with links turned from m<n> into the ids of the memories (memories without an id cannot be linked). */
	const extras = (item: Extras): Extras => {
		// n<k> stays symbolic ("new:k") until entriesToRecords gives the additions their ids.
		const links = (item.links ?? []).map((id) => (id.startsWith("n") ? `new:${id.slice(1)}` : memory[index(id)]?.id)).filter((id): id is string => Boolean(id));
		return { ...(links.length ? { links } : {}), ...(item.gist ? { gist: item.gist } : {}), ...(item.level ? { level: item.level } : {}) };
	};

	for (const { id, text, type, entities, ...more } of proposal.update) {
		const position = index(id);
		const old = slots[position];
		if (!old || touched.has(position)) continue;
		newArchive.push({ ...old, archived: today, reason: `superato da "${text}"` });
		slots[position] = { type: type ?? old.type, text, pinned: old.pinned, confirmations: old.confirmations + 1, last: today, ...withEntities(entities ?? old.entities), ...extras(more) };
		touched.add(position);
		counts.updated++;
	}
	for (const { id, reason } of proposal.forget) {
		const position = index(id);
		const old = slots[position];
		if (!old || old.pinned || touched.has(position)) continue;
		newArchive.push({ ...old, archived: today, reason: reason || "dimenticato" });
		slots[position] = undefined;
		touched.add(position);
		counts.forgotten++;
	}
	for (const { ids, text, type, entities, ...more } of proposal.merge) {
		const positions = ids.map(index).filter((position) => slots[position] && !touched.has(position));
		if (positions.length < 2) continue;
		const parts = positions.map((position) => slots[position] as MemoryEntry);
		slots[positions[0]] = {
			type: type ?? parts[0].type,
			text,
			pinned: parts.some((part) => part.pinned),
			confirmations: parts.reduce((sum, part) => sum + part.confirmations, 0) + 1,
			last: today,
			...withEntities(entities ?? [...new Set(parts.flatMap((part) => part.entities ?? []))]),
			...extras(more),
		};
		for (const position of positions.slice(1)) slots[position] = undefined;
		for (const position of positions) touched.add(position);
		counts.merged++;
	}
	for (const id of proposal.reinforce) {
		const position = index(id);
		const entry = slots[position];
		if (!entry || touched.has(position)) continue;
		entry.confirmations++;
		entry.last = today;
		touched.add(position);
		counts.reinforced++;
	}
	const known = new Set([...memory, ...slots.filter(Boolean) as MemoryEntry[]].map((entry) => normalize(entry.text)));
	const added: MemoryEntry[] = [];
	for (const [position, { type, text, entities, ...more }] of proposal.add.entries()) {
		const key = normalize(text);
		if (!key || known.has(key)) continue;
		known.add(key);
		if (type !== "episodio") {
			// Near-duplicates (measured: the same rule added twice with different wording).
			const words = contentWords(text);
			const covers = (a: Set<string>, b: Set<string>) => a.size >= 2 && [...a].every((word) => b.has(word));
			const position = slots.findIndex((entry) => entry && covers(contentWords(entry.text), words));
			if (position !== -1) {
				// The new text contains the old one: a fuller version or a correction ("…in inglese, non più in italiano").
				const old = slots[position]!;
				newArchive.push({ ...old, archived: today, reason: `superato da "${text}"` });
				slots[position] = { type, text, pinned: old.pinned, confirmations: old.confirmations + 1, last: today, ...withEntities(entities ?? old.entities) };
				counts.updated++;
				continue;
			}
			const contained = slots.find((entry) => entry && covers(words, contentWords(entry.text)));
			if (contained) {
				// A shorter wording of something already known: it confirms it.
				contained.confirmations++;
				contained.last = today;
				counts.reinforced++;
				continue;
			}
		}
		const entry: MemoryEntry = { id: `new:${position + 1}`, type, text, pinned: false, confirmations: 1, last: today, ...withEntities(entities), ...extras(more) };
		if (type === "episodio") newArchive.push({ ...entry, archived: today, reason: "episodio" });
		else added.push(entry);
		counts.added++;
	}
	return { memory: [...(slots.filter(Boolean) as MemoryEntry[]), ...added], archive: newArchive, counts };
}

/** Additions that carry nothing a future session can use (measured: "the user sent random messages, Pi asked…"). */
const NO_CONTENT = /messagg[io] casual|senza richieste? chiar|ha chiesto chiariment|chiedendo chiariment|ha salutato|saluti iniziali|nessuna richiesta|non ha fatto nulla|ha digitato .?clear|conversazione di prova|messaggi? di test|ha ringraziato/i;

/**
 * After the model, by code: drop additions without content (chit-chat, clarifications, a few words) and turn an
 * addition almost identical to a memory (same significant words) into a confirmation of it.
 */
export function filterProposal(proposal: Proposal, memory: MemoryEntry[]): { proposal: Proposal; dropped: string[] } {
	const dropped: string[] = [];
	const reinforce = new Set(proposal.reinforce);
	const memoryWords = memory.map((entry) => contentWords(entry.text));
	const similarity = (a: Set<string>, b: Set<string>) => {
		if (a.size === 0 || b.size === 0) return 0;
		let shared = 0;
		for (const word of a) if (b.has(word)) shared++;
		return shared / (a.size + b.size - shared);
	};
	const add = proposal.add.filter((item) => {
		const words = contentWords(item.text);
		if (NO_CONTENT.test(item.text) || words.size < 3) {
			dropped.push(`− senza contenuto: ${item.text.slice(0, 80)}`);
			return false;
		}
		const twin = memoryWords.findIndex((known) => similarity(words, known) >= 0.8);
		if (twin !== -1) {
			reinforce.add(`m${twin + 1}`);
			dropped.push(`↑ già noto (m${twin + 1}): ${item.text.slice(0, 80)}`);
			return false;
		}
		return true;
	});
	return { proposal: { ...proposal, add, reinforce: [...reinforce] }, dropped };
}

const DEDUP_STOPWORDS = new Set("il lo la i gli le un uno una di a da in con su per tra fra e o ma che non più sempre mai del della dei delle al alla ai alle nel nella nei è sono va vanno the a an of to in and or".split(" "));
/** Significant words, for near-duplicate detection ("non"/"mai" are ignored: containment decides the direction). */
function contentWords(text: string): Set<string> {
	return new Set(text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9/.<>_-]+/).filter((word) => word.length > 1 && !DEDUP_STOPWORDS.has(word)));
}

/** Memories not confirmed for `days` days (and not pinned): they fade into the archive. */
export function staleIds(memory: MemoryEntry[], today: string, days: number): string[] {
	const now = Date.parse(today);
	return memory.flatMap((entry, position) => {
		const last = Date.parse(entry.last);
		return !entry.pinned && Number.isFinite(last) && (now - last) / 86_400_000 > days ? [idOf(position)] : [];
	});
}

/** The memories that fit the context budget: pinned, then corrections, then by confirmations and recency. */
export function fitBudget(entries: MemoryEntry[], maxChars: number): MemoryEntry[] {
	const rank = (entry: MemoryEntry) => [entry.pinned ? 0 : 1, entry.type === "correzione" ? 0 : 1, -entry.confirmations] as const;
	const ordered = [...entries].sort((a, b) => {
		const [ra, rb] = [rank(a), rank(b)];
		for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
		return b.last.localeCompare(a.last);
	});
	const kept: MemoryEntry[] = [];
	let used = 0;
	for (const entry of ordered) {
		const cost = contextLine(entry).length + 1;
		if (used + cost > maxChars) continue;
		kept.push(entry);
		used += cost;
	}
	return kept;
}

/**
 * The cap applies to memory.md itself, not only to what is loaded: what Pi sees is what the file holds (no hidden
 * memories), and the /dream prompt stays bounded. Overflow (lowest priority for fitBudget) goes to the archive.
 */
export function enforceCap(memory: MemoryEntry[], archive: MemoryEntry[], maxChars: number, today: string) {
	const kept = new Set(fitBudget(memory, maxChars));
	const overflow = memory.filter((entry) => !kept.has(entry)).map((entry) => ({ ...entry, archived: today, reason: "oltre il tetto della memoria" }));
	return { memory: memory.filter((entry) => kept.has(entry)), archive: [...archive, ...overflow], moved: overflow.length };
}

// ---- Proposal from the model ------------------------------------------------------------------------------------

/** The model sometimes echoes the metadata it was shown ("(conferme 3, ultima 2026-10-01)", "(c 1, ultima …)"). */
const cleanText = (text: string) => text.replace(/\s*\((?:c|conferme)[:\s]+\d+[^)]*ultima[^)]*\)/gi, "").trim();

/**
 * Types the consolidation model writes instead of ours (measured: haiku proposed a taught project rule as "regola" and
 * the entry was lost). Recognisable synonyms map to a valid type, case aside; nonsense stays invalid.
 */
const TYPE_SYNONYMS: Record<string, MemoryType> = {
	regola: "decisione", regole: "decisione", rule: "decisione", rules: "decisione", convenzione: "decisione", convention: "decisione",
	vincolo: "decisione", constraint: "decisione", policy: "decisione", norma: "decisione", standard: "decisione", decision: "decisione",
	preference: "preferenza", correction: "correzione", fact: "fatto", episode: "episodio", evento: "episodio", event: "episodio",
};

export function normalizeType(type: unknown): unknown {
	if (typeof type !== "string") return type;
	const lower = type.trim().toLowerCase();
	return (MEMORY_TYPES as readonly string[]).includes(lower) ? lower : (TYPE_SYNONYMS[lower] ?? type);
}

export function parseProposal(text: string, memoryCount: number): { ok: true; proposal: Proposal; skipped: string[] } | { ok: false; error: string } {
	const cleaned = text.replace(/```(?:json)?/g, "");
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end <= start) return { ok: false, error: "la risposta del modello non contiene JSON" };
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(cleaned.slice(start, end + 1));
	} catch (error) {
		return { ok: false, error: `JSON non valido: ${(error as Error).message}` };
	}
	for (const key of ["add", "merge", "update"]) {
		if (!Array.isArray(raw[key])) continue;
		for (const item of raw[key] as unknown[]) if (typeof item === "object" && item !== null && "type" in item) (item as Record<string, unknown>).type = normalizeType((item as Record<string, unknown>).type);
	}
	const problems: string[] = [];
	const validId = (id: unknown): id is string => {
		const ok = typeof id === "string" && /^m\d+$/.test(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= memoryCount;
		if (!ok) problems.push(`id sconosciuto: ${String(id)}`);
		return ok;
	};
	const validType = (type: unknown, optional = false): type is MemoryType | undefined => {
		const ok = (optional && type === undefined) || (MEMORY_TYPES as readonly unknown[]).includes(type);
		if (!ok) problems.push(`tipo non valido: ${String(type)}`);
		return ok;
	};
	const validText = (text: unknown): text is string => {
		const ok = typeof text === "string" && text.trim().length > 0;
		if (!ok) problems.push("testo mancante");
		return ok;
	};
	/** Entities proposed by the model: short strings only, at most 8. */
	const entitiesOf = (value: unknown): string[] | undefined => {
		if (!Array.isArray(value)) return undefined;
		const kept = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && item.length <= 60).map((item) => item.trim()).slice(0, 8);
		return kept.length > 0 ? kept : undefined;
	};
	const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []);
	type Item = Record<string, unknown>;
	/** links (existing m<n> only, at most 5; unknown ones are dropped silently), gist (≤ 90 chars), level. */
	const additions = list("add").length;
	/** m<n> = an existing memory, n<k> = the k-th addition of this same proposal. */
	const linkable = (id: unknown): id is string =>
		typeof id === "string" && ((/^m\d+$/.test(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= memoryCount) || (/^n\d+$/.test(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= additions));
	const extrasOf = (item: Item): Extras => {
		const links = Array.isArray(item.links) ? [...new Set(item.links.filter(linkable))].slice(0, 5) : [];
		const gist = typeof item.gist === "string" && item.gist.trim() ? cleanText(item.gist).slice(0, 90) : undefined;
		const level = item.level === "personale" || item.level === "progetto" ? item.level : undefined;
		return { ...(links.length ? { links } : {}), ...(gist ? { gist } : {}), ...(level ? { level } : {}) };
	};
	// Measured: with an empty memory the model "merges" things said in the sessions using invented ids, and every item
	// was discarded. A merge/update whose ids do not exist but whose text is valid is new knowledge: keep it as an add.
	const knownId = (id: unknown) => typeof id === "string" && /^m\d+$/.test(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= memoryCount;
	const salvaged: Item[] = [];
	const salvage = (key: "merge" | "update") =>
		(raw[key] = list(key).filter((item) => {
			if (typeof item !== "object" || item === null) return true;
			const entry = item as Item;
			const ids = key === "merge" ? (Array.isArray(entry.ids) ? entry.ids : []) : [entry.id];
			if (ids.length > 0 && ids.every(knownId)) return true;
			if (typeof entry.text === "string" && entry.text.trim()) salvaged.push({ ...entry, type: (MEMORY_TYPES as readonly unknown[]).includes(entry.type) ? entry.type : "decisione" });
			return false;
		}));
	salvage("merge");
	salvage("update");
	raw.add = [...list("add"), ...salvaged];
	const proposal: Proposal = {
		add: list("add").filter((item): item is Item => typeof item === "object" && item !== null).filter((item) => validType(item.type) && validText(item.text)).map((item) => ({ type: item.type as MemoryType, text: cleanText(item.text as string), ...withEntities(entitiesOf(item.entities)), ...extrasOf(item) })),
		reinforce: list("reinforce").filter(validId),
		merge: list("merge").filter((item): item is Item => typeof item === "object" && item !== null).filter((item) => Array.isArray(item.ids) && item.ids.every(validId) && validText(item.text) && validType(item.type, true)).map((item) => ({ ids: item.ids as string[], text: cleanText(item.text as string), type: item.type as MemoryType | undefined, ...withEntities(entitiesOf(item.entities)), ...extrasOf(item) })),
		update: list("update").filter((item): item is Item => typeof item === "object" && item !== null).filter((item) => validId(item.id) && validText(item.text) && validType(item.type, true)).map((item) => ({ id: item.id as string, text: cleanText(item.text as string), type: item.type as MemoryType | undefined, ...withEntities(entitiesOf(item.entities)), ...extrasOf(item) })),
		forget: list("forget").filter((item): item is Item => typeof item === "object" && item !== null).filter((item) => validId(item.id)).map((item) => ({ id: item.id as string, reason: typeof item.reason === "string" ? item.reason : undefined })),
	};
	// Defense in depth: a memory never holds credentials, whatever the model wrote.
	const credential = (text: string) => {
		const hit = CREDENTIAL_PATTERN.test(text);
		if (hit) problems.push(`scartato (credenziali): ${text.slice(0, 60)}`);
		return !hit;
	};
	proposal.add = proposal.add.filter((item) => credential(item.text));
	proposal.merge = proposal.merge.filter((item) => credential(item.text));
	proposal.update = proposal.update.filter((item) => credential(item.text));
	if (typeof raw.quadro === "string" && raw.quadro.trim()) proposal.quadro = maskSecrets(raw.quadro.trim()).slice(0, QUADRO_CHARS);
	// Invalid items are skipped one by one (reported), never the whole consolidation.
	return { ok: true, proposal, skipped: problems };
}

/** The overview's ceiling: ~300 tokens in the system prompt, stable between two /dream (cached). */
export const QUADRO_CHARS = 1200;

export function buildDreamPrompt(memory: MemoryEntry[], sessions: string, today: string, options: { global?: boolean; capChars?: number; deep?: boolean; quadro?: string } = {}): string {
	const fill = options.capChars ? Math.round((memory.map(contextLine).join("\n").length / options.capChars) * 100) : 0;
	const current = memory.length > 0
		? memory.map((entry, position) => `${idOf(position)} ${contextLine(entry).slice(2)}${entry.pinned ? " 📌" : ""} (conferme ${entry.confirmations}, ultima ${entry.last || "?"})`).join("\n")
		: "(vuota)";
	return [
		`Consolida la memoria di Pi, come il sonno: tieni ciò che conta, scarta il resto. Oggi: ${today}.`,
		memory.length > 0 ? `La memoria contiene ${memory.length} ricordi (id da m1 a m${memory.length}): usa solo questi id, non inventare id.` : "La memoria è vuota: nessun id esiste, non inventare id; tutto ciò che va ricordato (anche più cose unite) va in add.",
		options.global ? "Memoria GLOBALE: tieni solo preferenze personali dell'utente valide in ogni progetto." : "Memoria del PROGETTO: decisioni, fatti, correzioni e preferenze per questo progetto.",
		"",
		"Memoria attuale:",
		current,
		"",
		...(options.deep && !options.global ? ["Quadro attuale del progetto:", options.quadro?.trim() || "(nessuno)", ""] : []),
		"Sessioni nuove (dalla più vecchia alla più recente):",
		sessions,
		"",
		"Regole:",
		"- Tieni solo ciò che servirà in sessioni future. Priorità massima alle correzioni dell'utente (\"no\", \"te l'ho già detto\", \"non farlo più\").",
		"- Niente dettagli di un singolo compito (cosa fa una funzione appena scritta), niente cose deducibili dal codice, mai segreti.",
		"- Ricordi brevi (≤ 20 parole), generali, come regola o fatto, SCRITTI IN ITALIANO anche se le sessioni sono in altre lingue.",
		"- Sessione che conferma un ricordo → reinforce. Duplicati → merge. Contraddizione → update con la versione più recente.",
		options.deep
			? "- Il perché di una decisione o un episodio → add con type \"episodio\" (resta ricordabile, ma viene richiamato solo se pertinente). Ogni ricordo ha \"entities\": 1-5 parole chiave (percorsi, identificatori, nomi di concetti) con cui lo si richiamerà."
			: "- Il perché di una decisione o un episodio utile solo su richiesta → add con type \"episodio\" (va in archivio).",
		...(options.deep
			? [
					"- \"links\": i ricordi a cui questo è collegato (ne spiega il perché, ne dipende, lo contraddice): così da uno si arriva all'altro. m<n> per quelli esistenti, n<k> per il k-esimo elemento di \"add\" di questa stessa risposta (es. n1). Collega ciò che riguarda la stessa cosa.",
					"- \"gist\": se il testo è lungo, una versione di massimo 10 parole per i promemoria brevi.",
					options.global ? "" : "- \"level\": \"personale\" per preferenze dell'utente valide in OGNI progetto (lingua, stile, strumenti personali), altrimenti ometti.",
					options.global ? "" : `- "quadro": riscrivi il quadro del progetto (massimo ${QUADRO_CHARS} caratteri, in italiano): com'è fatto, regole e decisioni chiave, cosa è in corso. Partendo da quello attuale e dalle sessioni nuove; omettilo se non cambia nulla.`,
					"- NON salvare: chiacchiere e saluti, messaggi senza contenuto (\"asd\", \"ok\", prove), richieste di chiarimento, cosa ha fatto Pi in una sessione senza una lezione da ricordare, tentativi falliti senza il perché.",
				].filter(Boolean)
			: []),
		"- forget solo per ricordi chiaramente sbagliati o inutili (allo sbiadire nel tempo pensa il codice).",
		...(fill >= 70 ? [`- La memoria è al ${fill}% del suo spazio: unisci i ricordi simili e sintetizza; aggiungi solo ciò che vale più di quello che c'è (il codice archivia l'eccedenza meno importante).`] : []),
		"",
		options.deep
			? 'Rispondi SOLO con JSON: {"add":[{"type":"correzione|preferenza|decisione|fatto|episodio","text":"...","entities":["..."],"links":["m2"],"gist":"..."}],"reinforce":["m1"],"merge":[{"ids":["m2","m3"],"type":"...","text":"...","entities":["..."]}],"update":[{"id":"m4","text":"...","entities":["..."],"links":["m1"]}],"forget":[{"id":"m5","reason":"..."}],"quadro":"..."}'
			: 'Rispondi SOLO con JSON: {"add":[{"type":"correzione|preferenza|decisione|fatto|episodio","text":"..."}],"reinforce":["m1"],"merge":[{"ids":["m2","m3"],"type":"...","text":"..."}],"update":[{"id":"m4","text":"..."}],"forget":[{"id":"m5","reason":"..."}]}',
	].join("\n");
}

// ---- Sessions (short-term memory) -------------------------------------------------------------------------------

const CREDENTIAL_PATTERN = /\b(password|passwd|pwd|parola d'ordine|api[ _-]?key|chiave api|token|secret|credenzial\w*)\b|\[segreto\]/i;

const SECRET_PATTERNS: [RegExp, string][] = [
	[/\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[segreto]"],
	// Plain words: "la password del gestionale è Gattino!2024", "chiave API fornitore: xk29-…".
	[/\b(password|passwd|pwd|parola d'ordine|chiave(?: api)?|api[ _-]?key|token|secret|segreto|credenziali)\b([^\n.;:=]{0,40}?)(?:\s*[=:]|\s(?:è|e'|is)\s)\s*["'(]?[^\s"'),;]+/gi, "$1$2: [segreto]"],
	[/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [segreto]"],
	[/\bsk-[A-Za-z0-9_-]{16,}/g, "[segreto]"],
	[/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[segreto]"],
	[/\bAKIA[0-9A-Z]{16}\b/g, "[segreto]"],
	[/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9._-]+/g, "[segreto]"],
	[/\b[a-f0-9]{32,}\b/gi, "[segreto]"],
	// Long mixed-case alphanumeric runs (base64-like keys). Slashes excluded so paths survive.
	[/\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Z])(?=[A-Za-z0-9+_-]*[a-z])[A-Za-z0-9+_-]{40,}={0,2}/g, "[segreto]"],
];

export function maskSecrets(text: string): string {
	return SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), text);
}

function firstLine(path: string): string {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(4096);
		const bytes = readSync(fd, buffer, 0, buffer.length, 0);
		return buffer.toString("utf8", 0, bytes).split("\n")[0];
	} finally {
		closeSync(fd);
	}
}

const jsonlFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name)) : []);
const byMtimeDesc = (files: string[]) => files.map((file) => ({ file, mtime: statSync(file).mtimeMs })).sort((a, b) => b.mtime - a.mtime).map(({ file }) => file);

function sessionCwd(file: string): string | undefined {
	try {
		const header = JSON.parse(firstLine(file));
		return header.type === "session" ? header.cwd : undefined;
	} catch {
		return undefined;
	}
}

/** Session files of a project, newest first. The cwd is read from each folder's first session line. */
export function findProjectSessions(root: string, cwd: string): string[] {
	if (!existsSync(root)) return [];
	// Fast path: Pi's folder naming ("/a/b" → "--a-b--"), verified against the first line.
	const guess = join(root, `--${cwd.replace(/^[/\\]+/, "").replace(/[/\\:]/g, "-")}--`);
	const guessed = jsonlFiles(guess);
	if (guessed.length > 0 && sessionCwd(guessed[0]) === cwd) return byMtimeDesc(guessed);
	for (const name of readdirSync(root)) {
		const files = jsonlFiles(join(root, name));
		if (files.length > 0 && sessionCwd(files[0]) === cwd) return byMtimeDesc(files);
	}
	return [];
}

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n")
			: "";
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Short-term memory to consolidate: user messages and the assistant's text (no tool output, secrets masked), only
 * after `since`. Newest sessions are kept first when the budget runs out; the result reads oldest → newest.
 */
export function lookback(files: string[], options: { since: string; maxChars: number; exclude?: string }): string {
	const blocks: string[] = [];
	let used = 0;
	for (const file of byMtimeDesc(files)) {
		if (file === options.exclude) continue;
		const lines: string[] = [];
		let started = "";
		for (const raw of readFileSync(file, "utf8").split("\n")) {
			if (!raw.trim()) continue;
			let record: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
			try {
				record = JSON.parse(raw);
			} catch {
				continue;
			}
			if (record.type !== "message" || !record.message || (record.timestamp ?? "") <= options.since) continue;
			const { role, content } = record.message;
			const text = maskSecrets(textOf(content)).trim();
			if (!text) continue;
			if (role === "user") lines.push(`Utente: ${clip(text, 1500)}`);
			else if (role === "assistant") lines.push(`Pi: ${clip(text, 800)}`);
			else continue;
			started ||= (record.timestamp ?? "").slice(0, 10);
		}
		if (lines.length === 0) continue;
		const block = `## Sessione ${started}\n${lines.join("\n")}`;
		if (used + block.length + 2 > options.maxChars) {
			const room = options.maxChars - used - 2;
			if (room > 40) blocks.push(block.slice(0, room));
			break;
		}
		blocks.push(block);
		used += block.length + 2;
	}
	return blocks.reverse().join("\n\n").slice(0, options.maxChars);
}

/**
 * One batch of the backlog, oldest messages first (like sleep, in order): `until` is the timestamp of the last message
 * included, to be stored as the new `since`, and `pending` counts the sessions with messages left for later batches.
 * Nothing is marked consolidated unless it was actually read.
 */
export function lookbackBatch(files: string[], options: { since: string; maxChars: number; exclude?: string }): { text: string; until: string; pending: number } {
	type Message = { at: string; line: string };
	const sessions: { started: string; messages: Message[] }[] = [];
	for (const file of files) {
		if (file === options.exclude) continue;
		const messages: Message[] = [];
		for (const raw of readFileSync(file, "utf8").split("\n")) {
			if (!raw.trim()) continue;
			let record: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
			try {
				record = JSON.parse(raw);
			} catch {
				continue;
			}
			const at = record.timestamp ?? "";
			if (record.type !== "message" || !record.message || at <= options.since) continue;
			const text = maskSecrets(textOf(record.message.content)).trim();
			if (!text) continue;
			if (record.message.role === "user") messages.push({ at, line: `Utente: ${clip(text, 1500)}` });
			else if (record.message.role === "assistant") messages.push({ at, line: `Pi: ${clip(text, 800)}` });
		}
		if (messages.length > 0) sessions.push({ started: messages[0].at, messages });
	}
	sessions.sort((a, b) => a.started.localeCompare(b.started));
	const blocks: string[] = [];
	let used = 0;
	let until = options.since;
	let consumed = 0;
	for (const session of sessions) {
		const header = `## Sessione ${session.started.slice(0, 10)}`;
		const lines: string[] = [];
		let size = header.length + 3;
		for (const message of session.messages) {
			if (used + size + message.line.length + 1 > options.maxChars) break;
			lines.push(message.line);
			size += message.line.length + 1;
			until = message.at;
		}
		if (lines.length > 0) {
			blocks.push(`${header}\n${lines.join("\n")}`);
			used += size;
		}
		if (lines.length < session.messages.length) break; // the rest of this session goes to the next batch
		consumed++;
	}
	return { text: blocks.join("\n\n"), until, pending: sessions.length - consumed };
}

/** Session files modified after `since` (ISO; "" = all). Only stats: free enough for session_start. */
export function countNewSessions(files: string[], since: string): number {
	const after = since ? Date.parse(since) : 0;
	return files.filter((file) => statSync(file).mtimeMs > after).length;
}

// ---- Recall (episodic memory) -----------------------------------------------------------------------------------

const STOPWORDS = new Set("che per con non una uno del della delle dei degli gli le il lo la nel nella sono come perche piu anche alla alle questo quello quella cosa quando dove sei era the and for with".split(" "));
const tokenize = (text: string) => normalize(text).split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word));

/** BM25 over archived memories. No dependencies; the interface leaves room for local embeddings later. */
export function bm25Search(entries: MemoryEntry[], query: string, limit: number): MemoryEntry[] {
	const docs = entries.map((entry) => tokenize(`${entry.text} ${entry.reason ?? ""}`));
	const terms = [...new Set(tokenize(query))];
	if (terms.length === 0 || docs.length === 0) return [];
	const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
	const k1 = 1.2;
	const b = 0.75;
	const scored = docs.map((doc, position) => {
		let score = 0;
		for (const term of terms) {
			const frequency = doc.filter((word) => word === term).length;
			if (frequency === 0) continue;
			const containing = docs.filter((other) => other.includes(term)).length;
			const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
			score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * doc.length) / average)));
		}
		return { position, score };
	});
	return scored.filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ position }) => entries[position]);
}
