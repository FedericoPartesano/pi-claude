import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { exportsTargets, parseJsonc, readProjectConfig, resolveBare } from "./config.ts";
import { buildGraph, loadProjectConfig, projectRoot, resolveImport, scanProject } from "./engine.ts";

const files: Record<string, string> = {
	"package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
	"tsconfig.base.json": `{
		// comment, trailing comma and a "//" inside a string below
		"compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["apps/web/src/*"], "@ui": ["packages/ui/src/index.ts"], }, "x": "http://a" },
	}`,
	// baseUrl comes from the extended file, so the target is relative to the root (as TypeScript does).
	"apps/web/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base", compilerOptions: { paths: { "~/*": ["apps/web/src/*"] } } }),
	"packages/ui/package.json": JSON.stringify({ name: "@acme/ui", main: "dist/index.js" }),
	"packages/core/package.json": JSON.stringify({ name: "@acme/core", source: "lib/main.ts" }),
};
const read = (path: string) => files[path];
const known = new Set(["apps/web/src/main.ts", "apps/web/src/lib/x.ts", "apps/web/src/hooks/useThing.ts", "packages/ui/src/index.ts", "packages/ui/src/button.tsx", "packages/core/lib/main.ts", "packages/core/utils/id.ts", "packages/core/src/deep/thing.ts", "svc/src/app/main.py", "svc/src/app/db.py", "svc/src/lib/util.py", "lib/other.ts"]);

test("parseJsonc: commenti, virgole finali e // dentro una stringa", () => {
	const parsed = parseJsonc(files["tsconfig.base.json"])!;
	assert.equal((parsed.compilerOptions as Record<string, unknown>).x, "http://a");
	assert.equal(parseJsonc("{ rotto"), undefined);
});

test("readProjectConfig: pacchetti con nome, alias paths, extends e baseUrl", () => {
	const config = readProjectConfig(Object.keys(files), read);
	assert.deepEqual(Object.keys(config.packages).sort(), ["@acme/core", "@acme/ui", "root"]);
	const web = config.ts.find((entry) => entry.dir === "apps/web")!;
	assert.deepEqual(web.paths.map(([pattern]) => pattern), ["~/*"]);
	assert.equal(web.baseUrlDir, "", "baseUrl ereditato dal file esteso");
	assert.deepEqual(config.ts.find((entry) => entry.dir === "")!.paths[0], ["@app/*", ["apps/web/src/*"]]);
});

test("alias: paths con *, alias esatto, baseUrl, e l'alias vale solo sotto la cartella del suo tsconfig", () => {
	const config = readProjectConfig(Object.keys(files), read);
	assert.equal(resolveBare("apps/web/src/main.ts", "~/lib/x", known, config), "apps/web/src/lib/x.ts");
	assert.equal(resolveBare("apps/web/src/main.ts", "~/hooks/useThing", known, config), "apps/web/src/hooks/useThing.ts");
	assert.equal(resolveBare("packages/core/lib/main.ts", "~/lib/x", known, config), undefined, "fuori da apps/web");
	assert.equal(resolveBare("packages/core/lib/main.ts", "@ui", known, config), "packages/ui/src/index.ts");
	assert.equal(resolveBare("packages/core/lib/main.ts", "lib/other", known, config), "lib/other.ts", "baseUrl");
	assert.equal(resolveBare("apps/web/src/main.ts", "react", known, config), undefined);
});

test("pacchetti del workspace: nome, sotto-percorso, campo source, main in dist non esistente → src/index", () => {
	const config = readProjectConfig(Object.keys(files), read);
	assert.equal(resolveImport("apps/web/src/main.ts", "@acme/ui", known, config), "packages/ui/src/index.ts");
	assert.equal(resolveImport("apps/web/src/main.ts", "@acme/ui/button", known, config), "packages/ui/src/button.tsx", "sotto src/");
	assert.equal(resolveImport("apps/web/src/main.ts", "@acme/core", known, config), "packages/core/lib/main.ts");
	assert.equal(resolveImport("apps/web/src/main.ts", "@acme/core/utils/id", known, config), "packages/core/utils/id.ts");
	assert.equal(resolveImport("apps/web/src/main.ts", "@acme/core/deep/thing", known, config), "packages/core/src/deep/thing.ts");
	assert.equal(resolveImport("apps/web/src/main.ts", "@acme/unknown", known, config), undefined);
});

test("python: import assoluto con layout src/ e radice per servizio", () => {
	assert.equal(resolveImport("svc/src/app/main.py", "app.db", known), "svc/src/app/db.py");
	assert.equal(resolveImport("svc/src/app/main.py", "lib.util", known), "svc/src/lib/util.py");
	assert.equal(resolveImport("svc/src/app/main.py", "os.path", known), undefined);
});

test("monorepo reale su disco: radice git da sotto-cartella, import tra pacchetti nel grafo", () => {
	const dir = mkdtempSync(join(tmpdir(), "graph-mono-"));
	try {
		const disk: Record<string, string> = {
			"package.json": files["package.json"],
			"packages/ui/package.json": files["packages/ui/package.json"],
			"packages/ui/src/index.ts": "export function Button() {}\n",
			"apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }),
			"apps/web/src/helper.ts": "export function help() {}\n",
			"apps/web/src/main.ts": "import { Button } from '@acme/ui';\nimport { help } from '~/helper';\nButton(); help();\n",
			".gitignore": "ignored/\n",
			"ignored/skip.ts": "export const x = 1;\n",
		};
		for (const [path, source] of Object.entries(disk)) {
			mkdirSync(dirname(join(dir, path)), { recursive: true });
			writeFileSync(join(dir, path), source);
		}
		execFileSync("git", ["init", "-q"], { cwd: dir });
		const root = projectRoot(join(dir, "apps/web/src"));
		assert.equal(root, projectRoot(dir));
		const inputs = scanProject(root);
		assert.equal(inputs.some((input) => input.path.startsWith("ignored/")), false);
		assert.ok(inputs.some((input) => input.path === "packages/ui/src/index.ts"), "vede anche gli altri pacchetti");
		const { graph } = buildGraph(inputs, undefined, loadProjectConfig(root));
		const has = (to: string) => graph.edges.some((edge) => edge.from === "apps/web/src/main.ts" && edge.to === to && edge.kind === "imports");
		assert.ok(has("packages/ui/src/index.ts"), "pacchetto del workspace");
		assert.ok(has("apps/web/src/helper.ts"), "alias tsconfig");
		const without = buildGraph(inputs).graph;
		assert.equal(without.edges.some((edge) => edge.to === "packages/ui/src/index.ts" && edge.kind === "imports"), false, "senza configurazione non si risolve");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("exports: chiave esatta, pattern con *, condizioni, target in dist → sorgente gemello", () => {
	const map = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./button": "./src/components/Button.tsx", "./icons/*": { import: "./dist/icons/*.js" }, "./internal/*": null };
	assert.ok(exportsTargets(map, ".").includes("src/index.d.ts"));
	assert.deepEqual(exportsTargets(map, "./button"), ["./src/components/Button.tsx", "./src/components/Button.tsx"]);
	assert.ok(exportsTargets(map, "./icons/arrow").includes("src/icons/arrow.js"));
	assert.deepEqual(exportsTargets(map, "./nothing"), []);
	assert.deepEqual(exportsTargets("./main.js", "."), ["./main.js", "./main.js"]);
	assert.deepEqual([...new Set(exportsTargets(["./a.js", { default: "./b.js" }], "."))], ["./a.js", "./b.js"], "array: prima voce, poi la condizione");
});

test("exports: un sotto-percorso rinominato dalla mappa si risolve; senza mappa si resta sul ripiego", () => {
	const mapped: Record<string, string> = {
		"packages/kit/package.json": JSON.stringify({ name: "@acme/kit", exports: { ".": "./dist/index.js", "./button": "./src/components/Button.tsx", "./icons/*": "./dist/icons/*.js" } }),
	};
	const config = readProjectConfig(Object.keys(mapped), (path) => mapped[path]);
	const sources = new Set(["packages/kit/src/index.ts", "packages/kit/src/components/Button.tsx", "packages/kit/src/icons/arrow.ts"]);
	assert.equal(resolveImport("apps/a.ts", "@acme/kit", sources, config), "packages/kit/src/index.ts", "dist/index.js → src/index.ts");
	assert.equal(resolveImport("apps/a.ts", "@acme/kit/button", sources, config), "packages/kit/src/components/Button.tsx");
	assert.equal(resolveImport("apps/a.ts", "@acme/kit/icons/arrow", sources, config), "packages/kit/src/icons/arrow.ts");
});

test("extends verso un pacchetto del workspace: nome, sotto-file, exports; un pacchetto esterno è ignorato", () => {
	const disk: Record<string, string> = {
		"packages/tsconfig/package.json": JSON.stringify({ name: "@acme/tsconfig", exports: { "./base": "./configs/base.json" } }),
		"packages/tsconfig/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "../..", paths: { "@lib/*": ["lib/*"] } } }),
		"packages/tsconfig/configs/base.json": JSON.stringify({ compilerOptions: { baseUrl: "../../..", paths: { "@shared/*": ["shared/*"] } } }),
		"apps/one/tsconfig.json": JSON.stringify({ extends: "@acme/tsconfig/base" }),
		"apps/two/tsconfig.json": JSON.stringify({ extends: "@acme/tsconfig" }),
		"apps/three/tsconfig.json": JSON.stringify({ extends: "@tsconfig/node20/tsconfig.json", compilerOptions: { paths: { "#x/*": ["./x/*"] } } }),
	};
	const config = readProjectConfig(Object.keys(disk), (path) => disk[path]);
	const entry = (dir: string) => config.ts.find((item) => item.dir === dir)!;
	assert.deepEqual(entry("apps/one").paths, [["@shared/*", ["shared/*"]]], "via exports, baseUrl relativo al file esteso");
	assert.deepEqual(entry("apps/two").paths, [["@lib/*", ["lib/*"]]], "nome nudo → tsconfig.json del pacchetto");
	assert.deepEqual(entry("apps/three").paths, [["#x/*", ["apps/three/x/*"]]], "esterno: solo i propri paths");
});

test("tsconfig con nome non standard: raggiunto da references (file o cartella), anche a catena", () => {
	const disk: Record<string, string> = {
		"tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./config/ts.json" }, { path: "./apps/site" }] }),
		"config/ts.json": JSON.stringify({ compilerOptions: { baseUrl: "..", paths: { "@core/*": ["core/*"] } }, references: [{ path: "./deep.json" }] }),
		"config/deep.json": JSON.stringify({ compilerOptions: { baseUrl: "..", paths: { "@deep/*": ["deep/*"] } }, references: [{ path: "../tsconfig.json" }] }),
		"apps/site/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@site/*": ["./src/*"] } } }),
		"other/orphan.json": JSON.stringify({ compilerOptions: { paths: { "@orphan/*": ["x/*"] } } }),
	};
	const config = readProjectConfig(Object.keys(disk), (path) => disk[path]);
	const patterns = config.ts.flatMap((entry) => entry.paths.map(([pattern]) => pattern)).sort();
	assert.deepEqual(patterns, ["@core/*", "@deep/*", "@site/*"], "il file orfano, mai citato, non si legge; il ciclo non blocca");
});

test("exports: condizioni personalizzate dopo quelle standard, più * nel target, cartelle con / finale", () => {
	const map = { ".": { "my-company": "./custom.js", import: "./std.js" }, "./a/*": "./src/*/lib/*.ts", "./features/": "./src/features/" };
	assert.deepEqual([...new Set(exportsTargets(map, "."))].slice(0, 2), ["./std.js", "./custom.js"]);
	assert.ok(exportsTargets(map, "./a/x").includes("./src/x/lib/x.ts"), "tutti gli * del target");
	assert.ok(exportsTargets(map, "./features/login/view").includes("./src/features/login/view"));
	assert.deepEqual(exportsTargets({ "./only": { browser: "./b.js" } }, "./only").slice(0, 1), ["./b.js"], "una condizione sconosciuta non è scartata");
});
