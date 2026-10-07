/** Deterministic entity extraction: paths, file names and code identifiers (lowercased). */
const PATH = /@?[\w.-]*[A-Za-z0-9_-](?:\/[\w.-]+)+\/?/g;
const FILE = /\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|cs|sh|ya?ml|toml|sql|html|css|jsonl)\b/g;
const CAMEL = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;
const SNAKE = /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g;

const clean = (value: string) => value.replace(/^@/, "").replace(/[.,;:]+$/, "").toLowerCase();

export function extractEntities(text: string): string[] {
	const found = new Set<string>();
	for (const raw of text.match(PATH) ?? []) {
		const path = clean(raw);
		// "e/o", "and/or" are not paths.
		if (path.length < 4) continue;
		found.add(path);
		const base = path.replace(/\/$/, "").split("/").pop() ?? "";
		if (/\.\w+$/.test(base)) found.add(base);
	}
	for (const pattern of [FILE, CAMEL, PASCAL, SNAKE]) for (const raw of text.match(pattern) ?? []) found.add(clean(raw));
	return [...found];
}
