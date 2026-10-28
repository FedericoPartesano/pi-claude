import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRules, ruleCandidates, globToRegExp, ruleReason, rulesFor } from "./rules.ts";

const file = (path: string, source: string) => ({ path, source });

test("extractRules: type regola o cartella regole/, con paths e titolo; le altre note no", () => {
	const rules = extractRules([
		file("stile.md", "---\ntype: regola\npaths: [src/**/*.ts, test/**]\n---\n# Mai any\nNon usare `any`."),
		file("regole/db.md", "# Query\nMai SQL nei controller."),
		file("idee.md", "# Cache\nsqlite."),
		file("vuota.md", "---\ntype: regola\n---\n"),
	]);
	assert.deepEqual(rules.map((r) => [r.title, r.paths]), [["Mai any", ["src/**/*.ts", "test/**"]], ["Query", []]]);
	assert.equal(rules[0].body, "Non usare `any`.");
});

test("paths come elenco a trattini", () => {
	const [rule] = extractRules([file("r.md", "---\ntype: regola\npaths:\n  - a/*.ts\n  - b/**\n---\nTesto")]);
	assert.deepEqual(rule.paths, ["a/*.ts", "b/**"]);
});

test("glob: ** attraversa cartelle, * no, graffe e ?", () => {
	assert.ok(globToRegExp("src/**/*.ts").test("src/a/b/c.ts"));
	assert.ok(globToRegExp("src/**/*.ts").test("src/c.ts"));
	assert.ok(!globToRegExp("src/*.ts").test("src/a/c.ts"));
	assert.ok(globToRegExp("src/**/*.{ts,tsx}").test("src/x/y.tsx"));
	assert.ok(!globToRegExp("src/**/*.{ts,tsx}").test("src/x/y.js"));
	assert.ok(globToRegExp("a?.md").test("ab.md"));
});

test("rulesFor: assoluti e relativi; senza paths vale per tutto; fuori dal progetto solo le senza paths", () => {
	const rules = extractRules([file("a.md", "---\ntype: regola\npaths: src/**/*.ts\n---\nA"), file("b.md", "---\ntype: regola\n---\nB")]);
	assert.deepEqual(rulesFor(rules, "/p/src/x.ts", "/p").map((r) => r.path), ["a.md", "b.md"]);
	assert.deepEqual(rulesFor(rules, "docs/x.md", "/p").map((r) => r.path), ["b.md"]);
	assert.deepEqual(rulesFor(rules, "/altro/x.ts", "/p").map((r) => r.path), ["b.md"]);
});

test("ruleReason: vuoto senza regole, testo stabile con le regole", () => {
	assert.equal(ruleReason([], "x.ts"), "");
	const rules = extractRules([file("a.md", "---\ntype: regola\n---\n# T\nCorpo")]);
	assert.equal(ruleReason(rules, "x.ts"), ruleReason(rules, "x.ts"));
	assert.match(ruleReason(rules, "x.ts"), /x\.ts.*\n- T \(a\.md\): Corpo/s);
});

test("ruleCandidates: propone sezioni non marcate con parole da regola; confermate diventano regole su ogni file", () => {
	const files = [
		file("note.md", "# Stile\nMai usare any. Sempre tipi espliciti.\n\n# Cache\nUsiamo sqlite.\n\n# Convenzioni di naming\nI file in kebab-case."),
		file("regole/x.md", "# Marcata\nMai X. Sempre Y."),
	];
	const found = ruleCandidates(files);
	assert.deepEqual(found.map((item) => item.section), ["Stile", "Convenzioni di naming"]);
	assert.deepEqual(ruleCandidates(files, [{ path: "note.md", section: "Stile" }]).map((item) => item.section), ["Convenzioni di naming"]);
	const rules = extractRules(files, [{ path: "note.md", section: "Stile" }]);
	assert.equal(rules[0].title, "Stile");
	assert.deepEqual(rules[0].paths, []);
	assert.match(rules[0].body, /Mai usare any/);
});
