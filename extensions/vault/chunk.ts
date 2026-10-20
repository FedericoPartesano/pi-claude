/**
 * Markdown chunker for the vault: one chunk per section (H1-H4, with the heading path), long sections split at block
 * boundaries (~MAX_CHARS), fenced code never split. Tags (frontmatter and #tag) and [[wikilinks]] go in the metadata.
 */
export interface VaultChunk {
	path: string;
	/** Heading path ("A › B"), "" before the first heading. */
	section: string;
	/** 1-based line where the chunk starts. */
	line: number;
	/** Text embedded and searched: path › section, then the body. */
	text: string;
	tags: string[];
	links: string[];
}

export const MAX_CHARS = 800;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

const cleanTag = (tag: string) => tag.trim().replace(/^["']|["']$/g, "").replace(/^#/, "");

/** Frontmatter block and the number of lines it takes; tags from `tags:` (inline list or `- item` lines). */
export function frontmatter(source: string): { tags: string[]; lines: number } {
	const lines = source.split("\n");
	if (lines[0]?.trim() !== "---") return { tags: [], lines: 0 };
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (end < 0) return { tags: [], lines: 0 };
	const tags: string[] = [];
	for (let index = 1; index < end; index++) {
		const match = /^tags\s*:\s*(.*)$/i.exec(lines[index]);
		if (!match) continue;
		const inline = match[1].replace(/^\[|\]$/g, "");
		if (inline.trim()) tags.push(...inline.split(",").map(cleanTag).filter(Boolean));
		for (let next = index + 1; next < end && /^\s*-\s+/.test(lines[next]); next++) tags.push(cleanTag(lines[next].replace(/^\s*-\s+/, "")));
	}
	return { tags, lines: end + 1 };
}

const wikilinks = (text: string) => [...new Set([...text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((match) => match[1].trim()))];
const inlineTags = (text: string) => [...new Set([...text.matchAll(/(?:^|\s)#([\p{L}][\p{L}\p{N}_/-]*)/gu)].map((match) => match[1]))];

/** Blocks of a section body: paragraphs split on blank lines, a fenced block is one block. */
function blocks(lines: string[]): string[] {
	const out: string[] = [];
	let current: string[] = [];
	let fenced = false;
	const flush = () => {
		if (current.join("").trim()) out.push(current.join("\n"));
		current = [];
	};
	for (const line of lines) {
		if (FENCE.test(line)) fenced = !fenced;
		if (!fenced && !line.trim() && !FENCE.test(line)) flush();
		else current.push(line);
	}
	flush();
	return out;
}

export function chunkMarkdown(path: string, source: string): VaultChunk[] {
	const meta = frontmatter(source);
	const lines = source.split("\n");
	const stack: string[] = [];
	const sections: { section: string; line: number; body: string[] }[] = [{ section: "", line: meta.lines + 1, body: [] }];
	let fenced = false;
	for (let index = meta.lines; index < lines.length; index++) {
		const line = lines[index];
		if (FENCE.test(line)) fenced = !fenced;
		const heading = fenced ? undefined : HEADING.exec(line);
		if (heading) {
			const level = heading[1].length;
			stack.length = level - 1;
			stack[level - 1] = heading[2];
			sections.push({ section: stack.filter(Boolean).join(" › "), line: index + 1, body: [] });
		} else sections[sections.length - 1].body.push(line);
	}
	const chunks: VaultChunk[] = [];
	for (const section of sections) {
		const parts: { text: string; offset: number }[] = [];
		let pending = "";
		for (const block of blocks(section.body)) {
			if (pending && pending.length + block.length + 2 > MAX_CHARS) {
				parts.push({ text: pending, offset: 0 });
				pending = "";
			}
			pending = pending ? `${pending}\n\n${block}` : block;
		}
		if (pending) parts.push({ text: pending, offset: 0 });
		for (const part of parts) {
			const body = part.text.trim();
			if (!body) continue;
			const head = section.section ? `${path} › ${section.section}` : path;
			chunks.push({ path, section: section.section, line: section.line, text: `${head}\n${body}`, tags: [...new Set([...meta.tags, ...inlineTags(body)])], links: wikilinks(body) });
		}
	}
	return chunks;
}
