import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph } from "./engine.ts";
import { bar, compact, duration, progressLines } from "./progress.ts";
import { estimateTokens, parseSemantic, semanticCandidates } from "./semantic.ts";

const input = (path: string, source: string) => ({ path, mtime: 1, size: source.length, read: () => source });
const DOC = `# Design\n${"The cache keeps the last answer per document. ".repeat(5)}\nSee src/a.ts.\n`;

test("semanticCandidates: solo documenti senza lettura valida; una modifica li rimette in coda", () => {
	const { graph } = buildGraph([input("README.md", DOC), input("src/a.ts", "export function alpha() {}\n"), input("tiny.md", "x")]);
	assert.deepEqual(semanticCandidates(graph), ["README.md"], "il codice e i doc minuscoli non contano");
	graph.semantic = { "README.md": { hash: graph.files["README.md"].hash, concepts: [], relates: [] } };
	assert.deepEqual(semanticCandidates(graph), []);
	const changed = buildGraph([input("README.md", `${DOC}more\n`), input("src/a.ts", "export function alpha() {}\n")], graph);
	assert.deepEqual(semanticCandidates(changed.graph), ["README.md"], "hash cambiato → da rileggere");
	assert.equal(changed.graph.semantic?.["README.md"], undefined, "la lettura vecchia è scartata");
});

test("parseSemantic: tollera recinti e testo attorno, scarta percorsi inventati e nomi vuoti", () => {
	const known = new Set(["src/a.ts"]);
	const raw = 'Ecco:\n```json\n{"concepts":[{"name":"Cache ultima risposta","note":"tiene l\'ultima"},{"name":"  "}],"relates":[{"path":"./src/a.ts","why":"implementa"},{"path":"inventato.ts","why":"?"}]}\n```';
	const record = parseSemantic(raw, "h1", known)!;
	assert.deepEqual(record.concepts, [{ name: "Cache ultima risposta", note: "tiene l'ultima" }]);
	assert.deepEqual(record.relates, [{ path: "src/a.ts", why: "implementa" }]);
	assert.equal(parseSemantic("niente json", "h", known), undefined);
	assert.equal(parseSemantic("{rotto", "h", known), undefined);
});

test("i concetti diventano nodi e archi; una lettura con hash vecchio non entra", () => {
	const { graph } = buildGraph([input("README.md", DOC), input("src/a.ts", "export function alpha() {}\n")]);
	const semantic = { "README.md": { hash: graph.files["README.md"].hash, concepts: [{ name: "Cache ultima risposta", note: "n" }], relates: [{ path: "src/a.ts", why: "w" }] } };
	const withSemantic = buildGraph([input("README.md", DOC), input("src/a.ts", "export function alpha() {}\n")], { ...graph, semantic });
	assert.ok(withSemantic.graph.nodes.some((node) => node.kind === "concept" && node.label === "Cache ultima risposta"));
	assert.ok(withSemantic.graph.edges.some((edge) => edge.from === "README.md" && edge.to === "concept:cache-ultima-risposta" && edge.kind === "explains"));
	const stale = buildGraph([input("README.md", DOC), input("src/a.ts", "export function alpha() {}\n")], { ...graph, semantic: { "README.md": { ...semantic["README.md"], hash: "vecchio" } } });
	assert.equal(stale.graph.nodes.some((node) => node.kind === "concept"), false);
});

test("estimateTokens cresce con i documenti; progress: barra, token, ETA", () => {
	const { graph } = buildGraph([input("README.md", DOC)]);
	assert.ok(estimateTokens(graph, ["README.md"]).input > estimateTokens(graph, []).input);
	assert.equal(bar(0.5, 10), "█████░░░░░");
	assert.equal(bar(2, 4), "████");
	assert.equal(bar(Number.NaN, 4), "░░░░");
	assert.equal(compact(12345), "12.3k");
	assert.equal(duration(125000), "2m05s");
	const base = { title: "T", phase: "p", done: 5, total: 20, input: 0, output: 0, cost: 0, startedAt: 0, now: 10_000 };
	assert.match(progressLines(base)[1], /25%\s+5\/20/);
	assert.match(progressLines(base)[2], /nessuno in questa fase/);
	assert.match(progressLines(base)[3], /restano ~30s/);
	assert.match(progressLines({ ...base, input: 12345, output: 900, cost: 0.0123, failed: 2, current: "docs/x.md" }, true).join("\n"), /12\.3k in · 900 out · \$0\.0123[\s\S]*2 non letti[\s\S]*Ora: docs\/x\.md[\s\S]*Esc/);
});
