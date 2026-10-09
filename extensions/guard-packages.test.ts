import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPackage, looksLike, parseInstalls } from "./guard/packages.ts";

test("parseInstalls: package names from npm/pnpm/yarn/bun/pip/uv/poetry commands, nothing for lockfile installs", () => {
	assert.deepEqual(parseInstalls("npm i -D lodash@4 @types/node"), [{ ecosystem: "npm", name: "lodash" }, { ecosystem: "npm", name: "@types/node" }]);
	assert.deepEqual(parseInstalls("cd web && pnpm add zod && pnpm test"), [{ ecosystem: "npm", name: "zod" }]);
	assert.deepEqual(parseInstalls("yarn add react-dom"), [{ ecosystem: "npm", name: "react-dom" }]);
	assert.deepEqual(parseInstalls("pip install requests==2.31 'rich>=13'"), [{ ecosystem: "pypi", name: "requests" }, { ecosystem: "pypi", name: "rich" }]);
	assert.deepEqual(parseInstalls("uv add httpx"), [{ ecosystem: "pypi", name: "httpx" }]);
	assert.deepEqual(parseInstalls("npm install"), []);
	assert.deepEqual(parseInstalls("npm ci && pip install -r requirements.txt"), []);
	assert.deepEqual(parseInstalls("npm i ./local-pkg git+https://github.com/x/y.git"), []);
	assert.deepEqual(parseInstalls("echo npm i lodash"), []);
});

test("looksLike: one or two edits away from a popular package, not the package itself", () => {
	assert.equal(looksLike("reqeusts", "pypi"), "requests");
	assert.equal(looksLike("lodahs", "npm"), "lodash");
	assert.equal(looksLike("lodash", "npm"), undefined);
	assert.equal(looksLike("my-internal-tool", "npm"), undefined);
});

test("assessPackage: missing from the registry, very new, or a lookalike; quiet for an established package", () => {
	const now = Date.parse("2026-10-09");
	assert.match(assessPackage({ ecosystem: "npm", name: "react-super-helpers-x" }, { found: false }, now)!, /non esiste/);
	assert.match(assessPackage({ ecosystem: "npm", name: "fresh-thing" }, { found: true, created: "2026-10-01" }, now)!, /8 giorni/);
	assert.match(assessPackage({ ecosystem: "pypi", name: "reqeusts" }, { found: true, created: "2020-01-01" }, now)!, /requests/);
	assert.equal(assessPackage({ ecosystem: "npm", name: "lodash" }, { found: true, created: "2012-04-23" }, now), undefined);
	assert.equal(assessPackage({ ecosystem: "npm", name: "x" }, undefined, now), undefined, "registry unreachable: silent");
});

test("no false alarms on real packages near popular names (review findings)", () => {
	for (const [name, eco] of [["preact", "npm"], ["nuxt", "npm"], ["just", "npm"], ["guid", "npm"], ["yarn", "npm"], ["boto", "pypi"], ["jinja", "pypi"], ["attr", "pypi"], ["pyaml", "pypi"]] as const) {
		assert.equal(looksLike(name, eco), undefined, name);
	}
	assert.equal(looksLike("raect", "npm"), "react", "a swap in a short name is still caught");
	assert.equal(looksLike("expres", "npm"), undefined, "a deletion in a short name is too ambiguous");
});

test("parseInstalls skips option values, non-registry specs and quoted text; splits on newlines", () => {
	assert.deepEqual(parseInstalls("npm i -w packages/a foo --tag next --prefix web"), [{ ecosystem: "npm", name: "foo" }]);
	assert.deepEqual(parseInstalls("npm i user/repo github:user/repo file:../x workspace:* @scope/pkg"), [{ ecosystem: "npm", name: "@scope/pkg" }]);
	assert.deepEqual(parseInstalls("pip install -t libs x --index-url https://x/simple"), [{ ecosystem: "pypi", name: "x" }]);
	assert.deepEqual(parseInstalls("poetry add --group dev pytest && uv add --python 3.12 httpx"), [{ ecosystem: "pypi", name: "pytest" }, { ecosystem: "pypi", name: "httpx" }]);
	assert.deepEqual(parseInstalls(`git commit -m "x; npm install foo"`), []);
	assert.deepEqual(parseInstalls("cd web\nnpm i zod"), [{ ecosystem: "npm", name: "zod" }]);
});

test("private registries: npm scopes or a default registry from .npmrc, a pip index from the environment", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { privateRegistry } = await import("./guard/packages.ts");
	const project = mkdtempSync(join(tmpdir(), "npmrc-"));
	const home = mkdtempSync(join(tmpdir(), "home-"));
	assert.equal(privateRegistry({ ecosystem: "npm", name: "@acme/lib" }, project, home, {}), false);
	writeFileSync(join(project, ".npmrc"), "@acme:registry=https://npm.acme.internal/\n");
	assert.equal(privateRegistry({ ecosystem: "npm", name: "@acme/lib" }, project, home, {}), true);
	assert.equal(privateRegistry({ ecosystem: "npm", name: "lodash" }, project, home, {}), false);
	writeFileSync(join(home, ".npmrc"), "registry=https://nexus.acme.internal/repository/npm/\n");
	assert.equal(privateRegistry({ ecosystem: "npm", name: "lodash" }, project, home, {}), true);
	assert.equal(privateRegistry({ ecosystem: "pypi", name: "x" }, project, home, { PIP_INDEX_URL: "https://pypi.acme/simple" }), true);
	assert.equal(privateRegistry({ ecosystem: "pypi", name: "x" }, project, home, {}), false);
});

test("redirections and shell syntax are not package names (real commands)", () => {
	assert.deepEqual(parseInstalls("npm i zod 2>&1 | tail -3"), [{ ecosystem: "npm", name: "zod" }]);
	assert.deepEqual(parseInstalls("pip install httpx 2> /dev/null"), [{ ecosystem: "pypi", name: "httpx" }]);
	assert.deepEqual(parseInstalls("(cd x && npm install 2>&1)"), []);
	assert.deepEqual(parseInstalls("npm i foo > log.txt"), [{ ecosystem: "npm", name: "foo" }]);
});
