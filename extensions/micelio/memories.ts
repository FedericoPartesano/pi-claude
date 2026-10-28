/**
 * Micelio memories as `recall` returns them: parsing the text, the search words taken from a prompt, the cards drawn
 * in the overlay. Pure, no pi-tui: the extension passes the colours in. Nothing here decides which memories show:
 * what Micelio returns is what is drawn, in the order it came.
 */
export interface Memory {
	id: string;
	type: string;
	title: string;
	author: string;
	date: string;
	tags: string;
	/** The body as Micelio sent it, markdown marks removed. */
	body: string;
}

const MAX_BODY = 2500;
const META = /^\[(\w+)\]\s+id:(\w+)\s+·\s+(.+?)\s+·\s+(\S+)\s*(.*)$/;

/** `recall` text: memories separated by `---`, each with `### title`, a `[type] id:… · author · date  #tags` line, the body. */
export function parseMemories(text: string): Memory[] {
	const seen = new Set<string>();
	const memories: Memory[] = [];
	for (const chunk of text.split(/\n---\n/)) {
		const start = chunk.indexOf("### ");
		if (start === -1) continue;
		const lines = chunk
			.slice(start)
			.split("\n")
			.filter((line) => !line.startsWith("==="));
		const meta = META.exec(lines[1] ?? "");
		if (!meta) continue;
		const [, type = "", id = "", author = "", date = "", tags = ""] = meta;
		if (seen.has(id)) continue;
		seen.add(id);
		const body = lines
			.slice(2)
			.filter((line) => !/^(RADICE\b|Fonte:)/.test(line.trim()))
			.join("\n")
			.replace(/[`*]/g, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		memories.push({
			id,
			type,
			title: (lines[0] ?? "").replace(/^###\s*/, "").replace(/[`*]/g, "").trim(),
			author,
			date,
			tags,
			body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
		});
	}
	return memories;
}

// Words that say nothing about the subject: the filler of spoken Italian.
const STOPWORDS = new Set(
	`allora anche ancora altro altri avere bene come cosa così dello della delle degli dove dopo essere fare fatto forse
	hanno insieme invece mentre molto nella nelle nello nostro oppure perché perche poi più possiamo potresti potrebbe prima
	quale quando quella quello questa questo qualche sempre senza sono stato stesso tanto tutti tutto vedere voglio vuoi
	fammi dimmi guarda vorrei fallo falla fai dammi ricordi ricordo`.split(/\s+/),
);

/** At most 4 words, the longest: the ones that name the subject. Empty when the prompt has none. */
export function keywordsOf(text: string): string {
	return [...new Set(text.toLowerCase().match(/[a-zà-ù0-9_-]{5,}/g) ?? [])]
		.filter((word) => !STOPWORDS.has(word))
		.sort((a, b) => b.length - a.length)
		.slice(0, 4)
		.join(" ");
}

/** A JSON-RPC reply, from a plain JSON body or from a server-sent-events stream (`data:` lines). */
export function decodeRpcReply(contentType: string, text: string): unknown {
	if (!contentType.includes("text/event-stream")) return JSON.parse(text);
	const data = text
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter((line) => line.length > 0);
	for (const line of data.reverse()) {
		try {
			const message = JSON.parse(line) as { result?: unknown; error?: unknown };
			if (message.result !== undefined || message.error !== undefined) return message;
		} catch {
			// a keep-alive or a partial line: look at the one before
		}
	}
	throw new Error("risposta SSE senza messaggio JSON-RPC");
}

// ── Drawing ────────────────────────────────────────────────────────────────

export interface Paint {
	chip: (type: string, text: string) => string;
	title: (text: string) => string;
	dim: (text: string) => string;
	frame: (text: string, selected: boolean) => string;
}

/** Visible length: ANSI colour codes do not count. */
export const visibleLength = (text: string): number => text.replace(/\x1b\[[0-9;]*m/g, "").length;

function truncate(text: string, width: number): string {
	return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function wrapPlain(text: string, width: number): string[] {
	const rows: string[] = [];
	for (const paragraph of text.split("\n")) {
		let row = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			if (row && row.length + 1 + word.length > width) {
				rows.push(row);
				row = "";
			}
			row = row ? `${row} ${word}` : word;
			while (row.length > width) {
				rows.push(row.slice(0, width));
				row = row.slice(width);
			}
		}
		rows.push(row);
	}
	return rows;
}

/** One memory as a bordered card of `width` columns: closed it is title + one line, open it shows the whole memory. */
export function cardLines(memory: Memory, width: number, isOpen: boolean, isSelected: boolean, paint: Paint): string[] {
	const inner = Math.max(10, width - 4);
	const head = `${memory.type} `;
	const pad = (text: string) => `${text}${" ".repeat(Math.max(0, inner - visibleLength(text)))}`;
	const rows: string[] = [];
	const titleRoom = inner - head.length - 2;
	if (isOpen) {
		const wrapped = wrapPlain(memory.title, titleRoom);
		wrapped.forEach((row, index) => rows.push(pad(index === 0 ? `${paint.chip(memory.type, ` ${memory.type} `)} ${paint.title(row)}` : `${" ".repeat(head.length + 2)}${paint.title(row)}`)));
		rows.push(pad(paint.dim(`${memory.author} · ${memory.date} · id:${memory.id}`)));
		if (memory.tags) rows.push(pad(paint.dim(memory.tags)));
		rows.push(pad(""));
		for (const row of wrapPlain(memory.body, inner)) rows.push(pad(row));
	} else {
		rows.push(pad(`${paint.chip(memory.type, ` ${memory.type} `)} ${paint.title(truncate(memory.title, titleRoom))}`));
		const excerpt = memory.body.replace(/\s+/g, " ");
		rows.push(pad(paint.dim(truncate(`${memory.author} · ${memory.date}${excerpt ? ` · ${excerpt}` : ""}`, inner))));
	}
	const bar = "─".repeat(inner + 2);
	return [paint.frame(`╭${bar}╮`, isSelected), ...rows.map((row) => `${paint.frame("│", isSelected)} ${row} ${paint.frame("│", isSelected)}`), paint.frame(`╰${bar}╯`, isSelected)];
}
