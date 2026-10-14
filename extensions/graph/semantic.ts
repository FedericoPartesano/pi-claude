/**
 * Optional LLM pass of /graph: a small model reads each document that changed and names the concepts it explains and the
 * project files it is about. Pure part (candidates, prompt, parsing, estimate); the model call lives in graph.ts.
 * The result is cached per document by content hash, so a document is read once until it changes.
 */
import type { Graph, SemanticRecord } from "./engine.ts";

export const MAX_DOC_CHARS = 6000;
export const MAX_DOCS = 80;
const OUTPUT_ESTIMATE = 250;
const PROMPT_OVERHEAD = 350;

/** Documents with no valid cached reading (new, changed, or never read), biggest-linked first so a cap keeps the useful ones. */
export function semanticCandidates(graph: Graph, limit = MAX_DOCS): string[] {
	return Object.entries(graph.files)
		.filter(([path, record]) => record.kind === "doc" && graph.semantic?.[path]?.hash !== record.hash && record.size > 40)
		.map(([path]) => path)
		.sort((a, b) => a.localeCompare(b))
		.slice(0, limit);
}

/** Rough tokens a run will use, before it starts: about 3.5 characters per token on the way in. */
export function estimateTokens(graph: Graph, paths: string[]): { input: number; output: number } {
	let input = 0;
	for (const path of paths) input += Math.round(Math.min(graph.files[path]?.size ?? 0, MAX_DOC_CHARS) / 3.5) + PROMPT_OVERHEAD;
	return { input, output: paths.length * OUTPUT_ESTIMATE };
}

export const SEMANTIC_SYSTEM =
	'You read one project document and extract a knowledge graph. Reply with only JSON: {"concepts":[{"name":"2-4 words","note":"one sentence"}],"relates":[{"path":"project file this document is about","why":"few words"}]}. At most 6 concepts: ideas, decisions, components, constraints the document defines or explains, in the language of the document. "relates" only lists paths that appear in the document text or in the known files list; never invent paths. No text outside the JSON.';

export function semanticPrompt(path: string, text: string, known: string[]): string {
	const body = text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n[…cut]` : text;
	return `Document: ${path}\n\nKnown project files (a sample): ${known.slice(0, 60).join(", ")}\n\n---\n${body}`;
}

/** The model's answer as a record: tolerant of code fences and extra text; unknown paths and empty names are dropped. */
export function parseSemantic(raw: string, hash: string, known: ReadonlySet<string>): SemanticRecord | undefined {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	let json: { concepts?: unknown; relates?: unknown };
	try {
		json = JSON.parse(raw.slice(start, end + 1));
	} catch {
		return undefined;
	}
	const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
	const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
	const concepts = list(json.concepts).map((item) => ({ name: clean(item?.name, 60), note: clean(item?.note, 200) })).filter((item) => item.name).slice(0, 6);
	const relates = list(json.relates).map((item) => ({ path: clean(item?.path, 300).replace(/^\.\//, ""), why: clean(item?.why, 120) })).filter((item) => known.has(item.path)).slice(0, 10);
	return { hash, concepts, relates };
}
