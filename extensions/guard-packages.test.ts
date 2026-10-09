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
