/**
 * Compact search results for the `search` tool: grouped by file (the path once), short lines, capped per file and in
 * total with counts of what was left out. Ranking of file names for `files: true`.
 */

export interface Match {
	path: string;
	line: number;
	text: string;
	/** A line around a match (rg --context), not a match itself. */
	context?: boolean;
}

export interface FormatOptions {
	perFile?: number;
	total?: number;
	maxLine?: number;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function formatMatches(matches: Match[], { perFile = 5, total = 60, maxLine = 160 }: FormatOptions): string {
	const byFile = new Map<string, Match[]>();
	for (const match of matches) byFile.set(match.path, [...(byFile.get(match.path) ?? []), match]);
	const lines: string[] = [];
	let shown = 0;
	let hiddenMatches = 0;
	const hiddenFiles = new Map<string, number>();
	for (const [path, fileMatches] of byFile) {
		const hits = fileMatches.filter((match) => !match.context);
		if (shown >= total) {
			hiddenMatches += hits.length;
			hiddenFiles.set(path, hits.length);
			continue;
		}
		lines.push(path);
		let fileShown = 0;
		for (const match of fileMatches) {
			if (!match.context && (fileShown >= perFile || shown >= total)) continue;
			// Context lines only around the matches that are shown.
			if (match.context && fileShown >= perFile) continue;
			lines.push(`  ${match.line}${match.context ? "-" : ":"} ${cut(match.text.trimEnd(), maxLine)}`);
			if (!match.context) {
				fileShown++;
				shown++;
			}
		}
		if (hits.length > fileShown) lines.push(`  … altri ${hits.length - fileShown} in questo file`);
	}
	if (hiddenMatches) {
		// Name the files left out (cheap), so the one that matters is never invisible.
		const named = [...hiddenFiles].slice(0, 40).map(([path, count]) => `${path} (${count})`).join(", ");
		const more = hiddenFiles.size > 40 ? ` … e altri ${hiddenFiles.size - 40} file` : "";
		lines.push(`… e altri ${hiddenMatches} risultati in ${hiddenFiles.size} file (restringi con path o glob): ${named}${more}`);
	}
	return lines.join("\n");
}

interface RgRecord {
	type: string;
	data: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
}

export function parseRgJson(output: string): Match[] {
	const matches: Match[] = [];
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		let record: RgRecord;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record.type !== "match" && record.type !== "context") continue;
		const text = (record.data.lines?.text ?? "").replace(/\r?\n$/, "");
		const match: Match = { path: record.data.path?.text ?? "", line: record.data.line_number ?? 0, text };
		matches.push(record.type === "context" ? { ...match, context: true } : match);
	}
	return matches;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).toLowerCase();
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** Paths matching `query` (case-insensitive), best first; a query with "/" is matched against the whole path. */
export function rankFiles(paths: string[], query: string): string[] {
	const q = query.toLowerCase();
	const tier = (path: string) => {
		if (q.includes("/")) return path.toLowerCase().includes(q) ? 2 : -1;
		const name = baseName(path);
		if (name === q || stem(name) === q) return 0;
		if (name.startsWith(q)) return 1;
		if (name.includes(q)) return 2;
		return -1;
	};
	return paths
		.map((path) => ({ path, rank: tier(path) }))
		.filter((entry) => entry.rank >= 0)
		.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path))
		.map((entry) => entry.path);
}
