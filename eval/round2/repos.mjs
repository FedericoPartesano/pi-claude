// The repos of round 2: how to install them and how to run their whole test suite with a parseable report.
import { parseTap, parseVitest } from "./runners.mjs";

export const REPOS = {
	yaml: {
		url: "https://github.com/eemeli/yaml",
		install: "npm ci --ignore-scripts --no-audit --no-fund",
		runner: "vitest",
		// The JSON report goes to a file under node_modules (ignored by git), so the agent's diff stays clean. Before
		// 2025-12-15 yaml used Jest, whose JSON report has the same shape.
		testCommand: () =>
			"rm -f node_modules/.eval-results.json; if grep -q '\"vitest\"' package.json; then npm test -- --reporter=json --outputFile=node_modules/.eval-results.json; else npm test -- --json --outputFile=node_modules/.eval-results.json; fi >/dev/null 2>&1; cat node_modules/.eval-results.json",
		parse: (output, root) => parseVitest(output, root),
	},
	marked: {
		url: "https://github.com/markedjs/marked",
		install: "npm ci --ignore-scripts --no-audit --no-fund",
		runner: "tap",
		// Its tests import the bundle in lib/: build it first.
		// A failed build must not leave the tests on an older bundle: no bundle, no report, "suite in errore".
		testCommand: () => "rm -rf lib && npm run build:esbuild >/dev/null 2>&1 || exit 1; node --test --test-reporter=tap test/run-spec-tests.js test/unit/*.test.js",
		parse: (output) => parseTap(output),
	},
	zod: {
		url: "https://github.com/colinhacks/zod",
		install: "npm ci --ignore-scripts --no-audit --no-fund",
		runner: "vitest",
		testCommand: () => "rm -f node_modules/.eval-results.json; npx vitest run --reporter=json --outputFile=node_modules/.eval-results.json >/dev/null 2>&1; cat node_modules/.eval-results.json",
		parse: (output, root) => parseVitest(output, root),
	},
};
