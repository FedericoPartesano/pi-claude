// Ground truth for the graph benchmark: import graph built with plain regexes over tracked source files, independent of Graphify.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes("node_modules"));
const set = new Set(files);

function resolve(from, spec) {
	if (!spec.startsWith(".")) return undefined;
	const base = normalize(join(dirname(from), spec));
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, join(base, "index.ts"), join(base, "index.tsx")]) if (set.has(candidate)) return candidate;
	return undefined;
}

/** file -> set of files it imports (static, dynamic, re-export). */
export const imports = new Map();
/** file -> set of files that import it. */
export const importers = new Map();
for (const file of files) {
	const text = readFileSync(join(root, file), "utf8");
	const found = new Set();
	for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g)) {
		const target = resolve(file, m[1]);
		if (target && target !== file) found.add(target);
	}
	imports.set(file, found);
	for (const target of found) (importers.get(target) ?? importers.set(target, new Set()).get(target)).add(file);
}

/** Everything that reaches `file` through imports (who breaks if it changes). */
export function dependents(file) {
	const seen = new Set();
	const queue = [file];
	while (queue.length) for (const next of importers.get(queue.shift()) ?? []) if (!seen.has(next)) (seen.add(next), queue.push(next));
	return seen;
}
export function dependencies(file) {
	const seen = new Set();
	const queue = [file];
	while (queue.length) for (const next of imports.get(queue.shift()) ?? []) if (!seen.has(next)) (seen.add(next), queue.push(next));
	return seen;
}
/** One shortest import chain from -> to, or undefined. */
export function chain(from, to) {
	const before = new Map([[from, undefined]]);
	const queue = [from];
	while (queue.length) {
		const at = queue.shift();
		if (at === to) break;
		for (const next of imports.get(at) ?? []) if (!before.has(next)) (before.set(next, at), queue.push(next));
	}
	if (!before.has(to)) return undefined;
	const path = [];
	for (let at = to; at !== undefined; at = before.get(at)) path.unshift(at);
	return path;
}
export const allFiles = files;
if (process.argv[1]?.endsWith("truth.mjs")) {
	for (const f of ["extensions/graph/progress.ts", "extensions/intent.ts", "pi-ui/src/panel.ts", "extensions/bug/viewer.ts", "extensions/graph/semantic.ts"]) console.log(f, "←", [...dependents(f)].length, [...dependents(f)].join(", "));
	console.log("chain", chain("extensions/graph.ts", "extensions/bug/viewer.ts"));
	console.log("deps graphify.ts", [...dependencies("extensions/graph/graphify.ts")].join(", "));
}
