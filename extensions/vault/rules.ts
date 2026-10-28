/**
 * Rules of the vault: notes marked `type: regola` (frontmatter) or kept under `regole/`, scoped to files with `paths:`
 * (globs relative to the project, e.g. `src/**\/*.ts`). Nothing sits in the prompt: the gate in vault.ts hands a rule
 * to the model only when it is about to write a file the rule covers.
 */
import { isAbsolute, relative } from "node:path";
import { chunkMarkdown } from "./chunk.ts";
import type { VaultFile } from "./index.ts";

export interface Rule {
	/** Source id of the note. */
	path: string;
	title: string;
	/** Globs; empty = every file. */
	paths: string[];
	body: string;
}

/** Longest body kept per rule: the gate must stay cheap. */
export const RULE_CHARS = 700;

/** Frontmatter keys as strings; list values (`[a, b]` or `- a` lines) as arrays. */
function fields(source: string): { meta: Map<string, string[]>; body: string } {
	const lines = source.split("\n");
	const meta = new Map<string, string[]>();
	if (lines[0]?.trim() !== "---") return { meta, body: source };
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (end < 0) return { meta, body: source };
	const clean = (value: string) => value.trim().replace(/^["']|["']$/g, "");
	for (let index = 1; index < end; index++) {
		const match = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(lines[index]);
		if (!match) continue;
		const values = match[2].replace(/^\[|\]$/g, "").split(",").map(clean).filter(Boolean);
		for (let next = index + 1; next < end && /^\s*-\s+/.test(lines[next]); next++) values.push(clean(lines[next].replace(/^\s*-\s+/, "")));
		meta.set(match[1].toLowerCase(), values);
	}
	return { meta, body: lines.slice(end + 1).join("\n") };
}

/** A section the user confirmed as a rule (stored in .pi/vault/regole.json); it applies to every file. */
export interface Confirmed {
	path: string;
	section: string;
}

export function extractRules(files: VaultFile[], confirmed: Confirmed[] = []): Rule[] {
	const extra = confirmed.flatMap((item) => {
		const file = files.find((candidate) => candidate.path === item.path);
		if (!file) return [];
		const body = chunkMarkdown(file.path, file.source).filter((chunk) => chunk.section === item.section).map((chunk) => chunk.text.slice(chunk.text.indexOf("\n") + 1).trim()).join("\n").trim();
		return body ? [{ path: item.path, title: item.section.split(" › ").pop() || item.path, paths: [], body: body.length > RULE_CHARS ? `${body.slice(0, RULE_CHARS)}…` : body } satisfies Rule] : [];
	});
	return [...extra, ...extractMarked(files)];
}

const CUES = /\b(mai|sempre|non usare|non usa|vietato|obbligatori[oa]|evitare|evita|convenzion[ei]|regol[ae]|pattern|deve|devono)\b/gi;

/** Unmarked sections that read like rules (cue words in the heading, or two or more in the body): proposals, never applied before the user confirms. */
export function ruleCandidates(files: VaultFile[], confirmed: Confirmed[] = [], limit = 15): { path: string; section: string; text: string }[] {
	const marked = new Set(extractMarked(files).map((rule) => rule.path));
	const known = new Set(confirmed.map((item) => `${item.path}\0${item.section}`));
	return files.filter((file) => !marked.has(file.path)).flatMap((file) =>
		chunkMarkdown(file.path, file.source).filter((chunk) => {
			if (!chunk.section || known.has(`${chunk.path}\0${chunk.section}`)) return false;
			const body = chunk.text.slice(chunk.text.indexOf("\n") + 1);
			return (chunk.section.match(CUES)?.length ?? 0) >= 1 || (body.match(CUES)?.length ?? 0) >= 2;
		}).map((chunk) => ({ path: chunk.path, section: chunk.section, text: chunk.text.slice(chunk.text.indexOf("\n") + 1).trim() })),
	).slice(0, limit);
}

function extractMarked(files: VaultFile[]): Rule[] {
	return files.flatMap((file) => {
		const { meta, body } = fields(file.source);
		const marked = meta.get("type")?.[0]?.toLowerCase() === "regola" || /^regole\//i.test(file.path);
		if (!marked) return [];
		const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
		const text = body.replace(/^#\s+.+$/m, "").trim();
		if (!text) return [];
		return [{ path: file.path, title: heading ?? file.path.replace(/\.md$/i, "").split("/").pop()!, paths: meta.get("paths") ?? [], body: text.length > RULE_CHARS ? `${text.slice(0, RULE_CHARS)}…` : text }];
	});
}

/** `**` crosses folders, `*` and `?` stay in one; `{a,b}` is alternation. Anchored. */
export function globToRegExp(glob: string): RegExp {
	let out = "";
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === "*") {
			if (glob[index + 1] === "*") {
				index++;
				if (glob[index + 1] === "/") (index++, (out += "(?:.*/)?"));
				else out += ".*";
			} else out += "[^/]*";
		} else if (char === "?") out += "[^/]";
		else if (char === "{") out += "(?:";
		else if (char === "}") out += ")";
		else if (char === ",") out += out.lastIndexOf("(?:") > out.lastIndexOf(")") ? "|" : ",";
		else out += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${out}$`);
}

/** Rules covering `file` (absolute or relative to `cwd`); files outside the project match only rules without paths. */
export function rulesFor(rules: Rule[], file: string, cwd: string): Rule[] {
	const rel = (isAbsolute(file) ? relative(cwd, file) : file).replace(/\\/g, "/").replace(/^\.\//, "");
	const outside = rel.startsWith("../");
	return rules.filter((rule) => !rule.paths.length || (!outside && rule.paths.some((glob) => globToRegExp(glob.replace(/^\.\//, "")).test(rel))));
}

/** The text handed to the model, or "" when nothing applies. Stable for the same rules. */
export function ruleReason(rules: Rule[], file: string): string {
	if (!rules.length) return "";
	const items = rules.map((rule) => `- ${rule.title} (${rule.path}): ${rule.body.replace(/\n{2,}/g, "\n").replace(/\n/g, "\n  ")}`).join("\n");
	return `Prima di scrivere ${file}: regole del progetto dal vault. Rispettale e ripeti la stessa modifica; non verranno richieste di nuovo in questo turno.\n${items}`;
}
