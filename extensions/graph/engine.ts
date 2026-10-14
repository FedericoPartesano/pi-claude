/**
 * Project graph engine: scan, per-file extraction (symbols, imports, mentioned names), incremental update by content
 * hash, and the nodes and edges derived from the extraction records. Pure and dependency free: the extension, the
 * report and the tools sit on top. Extraction is static (regular expressions through `lean/outline.ts`): no LLM, no
 * native parser. Edges that come from a guess carry confidence "inferred".
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, posix } from "node:path";
import { outline } from "../lean/outline.ts";
import { EMPTY_CONFIG, type ProjectConfig, findFile, readProjectConfig, resolveBare } from "./config.ts";

export const GRAPH_VERSION = 1;
export const MAX_FILE_BYTES = 400_000;
const MAX_SYMBOLS = 200;
const MAX_MENTIONS = 600;
/** Names defined in more files than this are too generic to link by name. */
const MAX_DEFINERS = 3;
const MIN_NAME = 4;
/** A name specific enough to link by (camelCase, PascalCase, snake_case, with digits, or long): plain short words are not. */
export const isSpecificName = (name: string) => name.length >= 10 || /[a-z][A-Z0-9]|_[A-Za-z0-9]|^[A-Z][a-z]+[A-Z]|^[A-Z][a-z]{4,}$/.test(name.replace(/^_+/, ""));

/** The code without its comments, so words in a comment do not become links. Approximate: strings are kept. */
export function withoutComments(source: string, path: string): string {
	if (/\.py$/i.test(path)) return source.replace(/(^|\s)#.*$/gm, "$1");
	return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|c|h|cpp|hpp|swift|sh)$/i;
const DOC = /\.(md|mdx)$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.git|\.pi|vendor|target|__pycache__)\//;
const LOCK = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.js)$/;
const TEST = /(\.test\.|\.spec\.|_test\.|(^|\/)tests?\/|(^|\/)__tests__\/)/;

export type NodeKind = "file" | "symbol" | "doc" | "test";
export type EdgeKind = "imports" | "defines" | "references" | "tests" | "documents";

export interface GraphNode {
	id: string;
	kind: NodeKind;
	label: string;
	file: string;
	line?: number;
	endLine?: number;
}

export interface GraphEdge {
	from: string;
	to: string;
	kind: EdgeKind;
	confidence: "extracted" | "inferred";
}

/** What one file contributes: the only thing kept per file, so an update re-reads changed files only. */
export interface FileRecord {
	hash: string;
	mtime: number;
	size: number;
	kind: "code" | "doc";
	symbols: { name: string; kind: "function" | "class" | "method"; line: number; endLine: number }[];
	imports: string[];
	mentions: string[];
	/** Path-like names written in a document ("extensions/goal.ts", "bench.mjs"). */
	paths: string[];
}

export interface Graph {
	version: number;
	builtAt: number;
	files: Record<string, FileRecord>;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface SourceInput {
	path: string;
	mtime: number;
	size: number;
	read: () => string;
}

export interface BuildStats {
	processed: number;
	reused: number;
	removed: number;
	files: number;
	nodes: number;
	edges: number;
}

export const isTestPath = (path: string) => TEST.test(path);
export const isIndexable = (path: string) => !SKIP_DIR.test(path) && !LOCK.test(path) && (CODE.test(path) || DOC.test(path));

const unique = <T>(values: T[]) => [...new Set(values)];

/** Raw import specifiers of a source file, for the languages we can read with a regular expression. */
export function importsOf(source: string, path: string): string[] {
	const found: string[] = [];
	if (/\.py$/i.test(path)) {
		for (const match of source.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\b/gm)) found.push(match[1]);
		for (const match of source.matchAll(/^\s*import\s+([\w.]+)/gm)) found.push(match[1]);
	} else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(path)) {
		for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g)) found.push(match[1]);
	}
	return unique(found);
}

/** Identifier-like words, without the ones too short to link by name; capped so a huge file stays small. */
export function mentionsOf(source: string): string[] {
	const found = new Set<string>();
	for (const match of source.matchAll(/[A-Za-z_$][\w$]*/g)) {
		if (match[0].length >= MIN_NAME) found.add(match[0]);
		if (found.size >= MAX_MENTIONS) break;
	}
	return [...found];
}

export function pathsOf(source: string): string[] {
	return unique([...source.matchAll(/[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z]{1,5}\b/g)].map((match) => match[0].replace(/^\.\//, "")));
}

export function extractFile(path: string, source: string): Pick<FileRecord, "kind" | "symbols" | "imports" | "mentions" | "paths"> {
	if (DOC.test(path)) return { kind: "doc", symbols: [], imports: [], mentions: mentionsOf(source).filter(isSpecificName), paths: pathsOf(source) };
	const symbols = outline(source, path).slice(0, MAX_SYMBOLS).map((symbol) => ({ name: symbol.name, kind: symbol.kind, line: symbol.line, endLine: symbol.endLine }));
	return { kind: "code", symbols, imports: importsOf(source, path), mentions: mentionsOf(withoutComments(source, path)).filter(isSpecificName), paths: [] };
}

/** The project file an import specifier points to, or undefined (package, builtin, not found). */
export function resolveImport(from: string, spec: string, known: ReadonlySet<string>, config: ProjectConfig = EMPTY_CONFIG): string | undefined {
	if (/\.py$/i.test(from)) {
		const dots = spec.match(/^\.*/)![0].length;
		const rest = spec.slice(dots).replace(/\./g, "/");
		if (dots) {
			const base = posix.join(...Array(Math.max(0, dots - 1)).fill(".."), dirname(from), rest);
			return [`${base}.py`, `${base}/__init__.py`].map((candidate) => posix.normalize(candidate)).find((candidate) => known.has(candidate));
		}
		// Absolute import: from the project root or from any folder above the file (src layouts, one root per service).
		for (let prefix = dirname(from); ; prefix = dirname(prefix)) {
			const base = prefix === "." ? rest : posix.join(prefix, rest);
			const found = [`${base}.py`, `${base}/__init__.py`].find((candidate) => candidate !== from && known.has(candidate));
			if (found) return found;
			if (prefix === "." || prefix === "/") return undefined;
		}
	}
	if (!spec.startsWith(".")) return resolveBare(from, spec, known, config);
	return findFile(posix.join(dirname(from), spec), known, from);
}

export function hashOf(source: string): string {
	return createHash("sha1").update(source).digest("hex").slice(0, 16);
}

/** Nodes and edges from the per-file records. Deterministic: the same records always give the same graph. */
export function deriveGraph(files: Record<string, FileRecord>, config: ProjectConfig = EMPTY_CONFIG): Pick<Graph, "nodes" | "edges"> {
	const paths = Object.keys(files).sort();
	const known = new Set(paths);
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const add = (edge: GraphEdge) => void edges.push(edge);
	const definers = new Map<string, string[]>();
	const byBase = new Map<string, string[]>();

	for (const path of paths) {
		const record = files[path];
		const isTest = record.kind === "code" && isTestPath(path);
		nodes.push({ id: path, kind: record.kind === "doc" ? "doc" : isTest ? "test" : "file", label: path, file: path });
		const base = posix.basename(path);
		byBase.set(base, [...(byBase.get(base) ?? []), path]);
		for (const symbol of record.symbols) {
			const id = `${path}#${symbol.name}`;
			nodes.push({ id, kind: "symbol", label: symbol.name, file: path, line: symbol.line, endLine: symbol.endLine });
			add({ from: path, to: id, kind: "defines", confidence: "extracted" });
			if (symbol.kind !== "method" && !isTestPath(path) && isSpecificName(symbol.name)) definers.set(symbol.name, [...(definers.get(symbol.name) ?? []), path]);
		}
	}

	for (const path of paths) {
		const record = files[path];
		const isTest = record.kind === "code" && isTestPath(path);
		for (const spec of record.imports) {
			const target = resolveImport(path, spec, known, config);
			if (target) add({ from: path, to: target, kind: isTest && !isTestPath(target) ? "tests" : "imports", confidence: "extracted" });
		}
		for (const name of record.mentions) {
			const owners = definers.get(name);
			if (!owners || owners.length > MAX_DEFINERS) continue;
			for (const owner of owners) if (owner !== path && record.kind === "code") add({ from: path, to: `${owner}#${name}`, kind: "references", confidence: "inferred" });
			if (record.kind === "doc") for (const owner of owners) add({ from: path, to: `${owner}#${name}`, kind: "documents", confidence: "inferred" });
		}
		for (const written of record.paths) {
			const target = known.has(written) ? written : byBase.get(posix.basename(written))?.length === 1 ? byBase.get(posix.basename(written))![0] : undefined;
			if (target && target !== path) add({ from: path, to: target, kind: "documents", confidence: known.has(written) ? "extracted" : "inferred" });
		}
	}

	const seen = new Set<string>();
	const unique = edges.filter((edge) => {
		const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return { nodes, edges: unique };
}

/**
 * Builds the graph from the files, reusing the records of `previous` for files that did not change (same size and
 * mtime, or the same content hash). Only new and changed files are read and extracted.
 */
export function buildGraph(inputs: SourceInput[], previous?: Graph, config: ProjectConfig = EMPTY_CONFIG): { graph: Graph; stats: BuildStats } {
	const old = previous?.version === GRAPH_VERSION ? previous.files : {};
	const files: Record<string, FileRecord> = {};
	let processed = 0;
	let reused = 0;
	for (const input of inputs) {
		const before = old[input.path];
		if (before && before.size === input.size && before.mtime === input.mtime) {
			files[input.path] = before;
			reused++;
			continue;
		}
		let source: string;
		try {
			source = input.read();
		} catch {
			continue;
		}
		const hash = hashOf(source);
		if (before?.hash === hash) {
			files[input.path] = { ...before, mtime: input.mtime, size: input.size };
			reused++;
			continue;
		}
		files[input.path] = { hash, mtime: input.mtime, size: input.size, ...extractFile(input.path, source) };
		processed++;
	}
	const removed = Object.keys(old).filter((path) => !files[path]).length;
	const { nodes, edges } = deriveGraph(files, config);
	const graph: Graph = { version: GRAPH_VERSION, builtAt: Date.now(), files, nodes, edges };
	return { graph, stats: { processed, reused, removed, files: Object.keys(files).length, nodes: nodes.length, edges: edges.length } };
}

/** Root of the git repository `cwd` is in (the project is the whole repository, not the folder pi was started in). */
export function projectRoot(cwd: string): string {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || cwd;
	} catch {
		return cwd;
	}
}

/** Every file of the repository (tracked, plus untracked and not ignored), relative to its root; empty outside git. */
export function listProjectFiles(root: string): string[] {
	try {
		return unique(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 256e6, stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean)).sort();
	} catch {
		return [];
	}
}

/** Workspace packages and tsconfig aliases of the repository. */
export function loadProjectConfig(root: string, listed = listProjectFiles(root)): ProjectConfig {
	const wanted = listed.filter((path) => /(^|\/)(package\.json|(ts|js)config(\.[\w-]+)?\.json)$/.test(path) && !SKIP_DIR.test(path));
	return readProjectConfig(wanted, (path) => {
		try {
			return readFileSync(`${root}/${path}`, "utf8");
		} catch {
			return undefined;
		}
	});
}

/** Indexable files of a project, with paths relative to `root`. */
export function scanProject(root: string, listed = listProjectFiles(root)): SourceInput[] {
	const inputs: SourceInput[] = [];
	for (const path of listed) {
		if (!isIndexable(path)) continue;
		try {
			const stat = statSync(`${root}/${path}`);
			if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
			inputs.push({ path, mtime: Math.round(stat.mtimeMs), size: stat.size, read: () => readFileSync(`${root}/${path}`, "utf8") });
		} catch {
			// deleted between the listing and the stat
		}
	}
	return inputs;
}

/** Files that differ from the graph (new, changed by size or mtime, deleted): cheap, nothing is read. */
export function staleCount(inputs: SourceInput[], graph: Graph): number {
	const seen = new Set<string>();
	let stale = 0;
	for (const input of inputs) {
		seen.add(input.path);
		const record = graph.files[input.path];
		if (!record || record.size !== input.size || record.mtime !== input.mtime) stale++;
	}
	for (const path of Object.keys(graph.files)) if (!seen.has(path)) stale++;
	return stale;
}
