// "@file" in the composer: the mention being typed and the project files that match it.

/** The "@query" that ends at the caret, when "@" starts a word; undefined otherwise. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
	const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
	return match ? { start: caret - match[2].length - 1, query: match[2] } : undefined;
}

/** File names starting with the query first, then paths containing it (case-insensitive); at most `n`. */
export function matchFiles(files: string[], query: string, n = 8): string[] {
	const q = query.toLowerCase();
	const name = (path: string) => path.slice(path.lastIndexOf("/") + 1).toLowerCase();
	const first = files.filter((path) => name(path).startsWith(q));
	const then = files.filter((path) => !name(path).startsWith(q) && path.toLowerCase().includes(q));
	return [...first, ...then].slice(0, n);
}
