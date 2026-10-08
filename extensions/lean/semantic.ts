/**
 * Semantic code search: the project's symbols (from outline) embedded with pi-memory's local model, kept in an index
 * that re-embeds only the files whose mtime changed. Search = cosine against the query.
 */
import type { Embedder } from "../../pi-memory/src/embed.ts";
import { outline } from "./outline.ts";

export interface Chunk {
	path: string;
	/** Symbol name, "" for a file without symbols. */
	name: string;
	line: number;
	text: string;
}

const CHUNK_LINES = 15;

export function chunksFor(path: string, source: string): Chunk[] {
	const lines = source.split("\n");
	const symbols = outline(source, path).filter((symbol) => symbol.kind !== "method" || symbol.endLine - symbol.line >= 3);
	if (!symbols.length) return [{ path, name: "", line: 1, text: `${path}\n${lines.slice(0, 40).join("\n")}` }];
	return symbols.map((symbol) => ({
		path,
		name: symbol.name,
		line: symbol.line,
		text: `${path} ${symbol.name}\n${lines.slice(symbol.line - 1, Math.min(symbol.endLine, symbol.line - 1 + CHUNK_LINES)).join("\n")}`,
	}));
}

interface Entry {
	path: string;
	name: string;
	line: number;
	vector: number[];
}

export interface SourceFile {
	path: string;
	mtime: number;
	source: string;
}

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
	let dot = 0;
	for (let index = 0; index < a.length; index++) dot += a[index] * b[index];
	return dot;
};

export class CodeIndex {
	private mtimes = new Map<string, number>();
	private entries: Entry[] = [];

	/** Brings the index up to date with `files` (the whole project): new/changed files embedded, missing ones dropped. */
	async update(files: SourceFile[], embedder: Embedder): Promise<number> {
		const present = new Set(files.map((file) => file.path));
		const changed = files.filter((file) => this.mtimes.get(file.path) !== file.mtime);
		const stale = new Set([...changed.map((file) => file.path), ...[...this.mtimes.keys()].filter((path) => !present.has(path))]);
		this.entries = this.entries.filter((entry) => !stale.has(entry.path));
		for (const path of stale) this.mtimes.delete(path);
		const chunks = changed.flatMap((file) => chunksFor(file.path, file.source));
		for (let start = 0; start < chunks.length; start += 32) {
			const batch = chunks.slice(start, start + 32);
			const vectors = await embedder.embed(batch.map((chunk) => chunk.text), "passage");
			batch.forEach((chunk, index) => this.entries.push({ path: chunk.path, name: chunk.name, line: chunk.line, vector: Array.from(vectors[index]) }));
		}
		for (const file of changed) this.mtimes.set(file.path, file.mtime);
		return changed.length;
	}

	async search(query: string, embedder: Embedder, k = 8): Promise<{ path: string; name: string; line: number; score: number }[]> {
		const [vector] = await embedder.embed([query], "query");
		return this.entries
			.map((entry) => ({ path: entry.path, name: entry.name, line: entry.line, score: cosine(vector, entry.vector) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, k);
	}

	toJSON() {
		return { mtimes: Object.fromEntries(this.mtimes), entries: this.entries };
	}

	static fromJSON(data: { mtimes: Record<string, number>; entries: Entry[] }): CodeIndex {
		const index = new CodeIndex();
		index.mtimes = new Map(Object.entries(data.mtimes ?? {}));
		index.entries = data.entries ?? [];
		return index;
	}
}
