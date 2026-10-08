import { test } from "node:test";
import assert from "node:assert/strict";
import { isHard, issueNumbers, leaksFix, splitFiles } from "../mine.mjs";

test("source and test files are told apart", () => {
	assert.deepEqual(splitFiles(["src/parse.ts", "tests/parse.test.ts", "src/__tests__/x.js", "test/doc/spec.js", "src/lexer.spec.ts", "README.md"]), {
		source: ["src/parse.ts", "README.md"],
		tests: ["tests/parse.test.ts", "src/__tests__/x.js", "test/doc/spec.js", "src/lexer.spec.ts"],
	});
});

test("hard = at least 2 source files or more than 20 source lines", () => {
	assert.equal(isHard({ sourceFiles: 1, sourceLines: 20 }), false);
	assert.equal(isHard({ sourceFiles: 1, sourceLines: 21 }), true);
	assert.equal(isHard({ sourceFiles: 2, sourceLines: 3 }), true);
});

test("issue numbers from commit messages", () => {
	assert.deepEqual(issueNumbers("fix: anchors in flow maps (#512)\n\nFixes #498, closes eemeli/yaml#501"), [512, 498, 501]);
	assert.deepEqual(issueNumbers("chore: bump"), []);
});

test("an issue that already contains the fix is rejected", () => {
	const diff = "@@ -1,3 +1,4 @@\n+    if (token.type === 'anchor') return resolveAnchor(token, context);\n+    const offset = start + token.source.length;\n";
	assert.equal(leaksFix("Anchors break in flow maps.\n```yaml\na: [&x 1, *x]\n```", diff), false);
	assert.equal(leaksFix("Fix: `if (token.type === 'anchor') return resolveAnchor(token, context);` and `const offset = start + token.source.length;`", diff), true);
	assert.equal(leaksFix("Patch:\n```diff\n@@ -1 +1 @@\n-a\n+b\n```", diff), true);
});
