import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, findNode, neighbors, searchNodes, shortestPath } from "./analyze.ts";
import { buildGraph, isIndexable, resolveImport, type SourceInput } from "./engine.ts";

const make = (files: Record<string, string>, mtime = 1): SourceInput[] =>
	Object.entries(files).map(([path, source]) => ({ path, mtime, size: source.length, read: () => source }));

const PROJECT: Record<string, string> = {
	"src/main.ts": "import { parse } from './parse.ts';\nimport { render } from './render/view.js';\nexport function main() { buildTokens(); return render(parse('x')); }\n",
	"src/parse.ts": "export function parse(text: string) { return text; }\nexport function buildTokens() {}\nexport class Lexer {}\n",
	"src/render/view.ts": "import { parse } from '../parse';\nexport function render(value: string) { return parse(value); }\n",
	"src/render/index.ts": "export * from './view.ts';\n",
	"src/parse.test.ts": "import { parse } from './parse.ts';\nparse('a');\n",
	"util/strings.py": "from .helpers import clean\n\ndef shout(text):\n    return clean(text).upper()\n",
	"util/helpers.py": "def clean(text):\n    return text.strip()\n",
	"README.md": "Entry point is `src/main.ts`; the Lexer class lives in src/parse.ts. See also missing/file.ts.\n",
};

type G = ReturnType<typeof buildGraph>["graph"];
const edge = (graph: G, from: string, to: string, kind: string) => graph.edges.find((e) => e.from === from && e.to === to && e.kind === kind);

test("resolveImport: relative con estensione, .js→.ts, index, python relativo, pacchetti ignorati", () => {
	const known = new Set(["src/a.ts", "src/b.ts", "src/dir/index.ts", "pkg/m.py", "pkg/sub/__init__.py", "pkg/helpers.py"]);
	assert.equal(resolveImport("src/a.ts", "./b", known), "src/b.ts");
	assert.equal(resolveImport("src/a.ts", "./b.js", known), "src/b.ts");
	assert.equal(resolveImport("src/a.ts", "./dir", known), "src/dir/index.ts");
	assert.equal(resolveImport("src/a.ts", "react", known), undefined);
	assert.equal(resolveImport("pkg/m.py", ".helpers", known), "pkg/helpers.py");
	assert.equal(resolveImport("pkg/m.py", "pkg.sub", known), "pkg/sub/__init__.py");
	assert.equal(resolveImport("pkg/m.py", ".nope", known), undefined);
});

test("buildGraph: nodi e archi imports/tests/defines/documents con la confidenza giusta", () => {
	const { graph, stats } = buildGraph(make(PROJECT));
	assert.equal(stats.files, 8);
	assert.ok(edge(graph, "src/main.ts", "src/parse.ts", "imports"));
	assert.ok(edge(graph, "src/main.ts", "src/render/view.ts", "imports"), "specificatore .js risolto al .ts");
	assert.ok(edge(graph, "src/render/view.ts", "src/parse.ts", "imports"));
	assert.ok(edge(graph, "src/render/index.ts", "src/render/view.ts", "imports"));
	assert.ok(edge(graph, "src/parse.test.ts", "src/parse.ts", "tests"));
	assert.ok(edge(graph, "util/strings.py", "util/helpers.py", "imports"));
	assert.ok(edge(graph, "src/parse.ts", "src/parse.ts#Lexer", "defines"));
	assert.equal(graph.nodes.find((n) => n.id === "src/parse.test.ts")!.kind, "test");
	assert.equal(graph.nodes.find((n) => n.id === "README.md")!.kind, "doc");
	assert.equal(edge(graph, "README.md", "src/main.ts", "documents")!.confidence, "extracted");
	assert.ok(edge(graph, "README.md", "src/parse.ts#Lexer", "documents"), "doc cita un simbolo");
	assert.equal(edge(graph, "src/main.ts", "src/parse.ts#buildTokens", "references")!.confidence, "inferred");
	assert.equal(edge(graph, "src/main.ts", "src/parse.ts#parse", "references"), undefined, "nome semplice: non si lega per nome");
	assert.equal(graph.edges.some((e) => e.to.includes("missing")), false);
});

test("una parola in un commento non crea un riferimento", () => {
	const { graph } = buildGraph(make({ "a.ts": "export function buildTokens() {}\n", "b.ts": "// calls buildTokens later\n/* buildTokens */\nexport const x = 1;\n" }));
	assert.equal(graph.edges.some((e) => e.kind === "references"), false);
});

test("file ignorati non entrano; nomi troppo comuni non generano riferimenti", () => {
	const files: Record<string, string> = { "a/x.ts": "export function run() {}\n", "b/y.ts": "export function run() {}\n", "c/z.ts": "export function run() {}\n", "d/w.ts": "export function run() {}\n", "e/v.ts": "run(); \n" };
	const { graph } = buildGraph(make(files));
	assert.equal(graph.edges.some((e) => e.kind === "references"), false);
});

test("incremental: stessi file → tutto riusato; uno cambiato, uno nuovo, uno cancellato → solo quelli", () => {
	const first = buildGraph(make(PROJECT));
	const again = buildGraph(make(PROJECT), first.graph);
	assert.equal(again.stats.processed, 0);
	assert.equal(again.stats.reused, 8);
	assert.deepEqual(again.graph.edges, first.graph.edges);

	const changed: Record<string, string> = { ...PROJECT, "src/parse.ts": "export function parse(text: string) { return text; }\nexport function lex() {}\n", "src/new.ts": "import { lex } from './parse.ts';\nlex();\n" };
	delete changed["util/helpers.py"];
	const inputs = Object.entries(changed).map(([path, source]) => ({ path, mtime: path === "src/parse.ts" ? 2 : 1, size: source.length, read: () => source }));
	const next = buildGraph(inputs, first.graph);
	assert.equal(next.stats.processed, 2, "parse.ts e new.ts");
	assert.equal(next.stats.removed, 1);
	assert.ok(edge(next.graph, "src/new.ts", "src/parse.ts", "imports"));
	assert.ok(next.graph.nodes.some((n) => n.id === "src/parse.ts#lex"));
	assert.equal(edge(next.graph, "util/strings.py", "util/helpers.py", "imports"), undefined);
});

test("incremental: mtime cambiato ma contenuto uguale → riusato, non rielaborato", () => {
	const first = buildGraph(make(PROJECT));
	const touched = buildGraph(make(PROJECT, 99), first.graph);
	assert.equal(touched.stats.processed, 0);
	assert.equal(touched.stats.reused, Object.keys(PROJECT).length);
});

test("analyze: comunità separano i due gruppi, centrali e risultato deterministico", () => {
	const { graph } = buildGraph(make(PROJECT));
	const one = analyze(graph);
	assert.deepEqual(one, analyze(graph));
	assert.equal(one.of["util/strings.py"], one.of["util/helpers.py"]);
	assert.notEqual(one.of["src/main.ts"], one.of["util/strings.py"]);
	assert.equal(one.of["src/main.ts"], one.of["src/parse.ts"]);
	assert.equal(one.central[0].path, "src/parse.ts");
	assert.equal(Object.keys(one.of).length, 8);
});

test("query: search, find, neighbors, path", () => {
	const { graph } = buildGraph(make(PROJECT));
	const analysis = analyze(graph);
	assert.equal(searchNodes(graph, "lexer", analysis)[0].id, "src/parse.ts#Lexer");
	assert.equal(findNode(graph, "src/main.ts")!.kind, "file");
	assert.equal(findNode(graph, "nothing-here-xyz"), undefined);
	const around = neighbors(graph, "src/parse.ts");
	assert.ok(around.some((n) => n.node.id === "src/main.ts" && n.direction === "in" && n.kind === "imports"));
	const path = shortestPath(graph, "src/main.ts", "src/parse.ts#Lexer")!;
	assert.deepEqual(path.map((step) => step.node.id), ["src/main.ts", "src/parse.ts", "src/parse.ts#Lexer"]);
	assert.equal(shortestPath(graph, "src/main.ts", "util/helpers.py"), undefined);
});

test("cartelle di dipendenze e di build non entrano nel grafo, nemmeno annidate", () => {
	const deps = "node" + "_modules";
	for (const path of [`${deps}/x/index.js`, `pi-ui/${deps}/y/a.ts`, "dist/a.js", `a/b/${deps}/c.md`]) assert.equal(isIndexable(path), false, path);
	assert.equal(isIndexable("src/helper.ts"), true);
});
