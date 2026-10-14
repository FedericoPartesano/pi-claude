/**
 * Where an import points to, in a project with several packages: relative paths, packages of the workspace (every
 * package.json with a name), and the `baseUrl` / `paths` aliases of tsconfig.json and jsconfig.json (with `extends`).
 * Pure: the files are read through a callback, so it is testable without a disk.
 */
import { dirname, posix } from "node:path";

const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py"];

export interface TsConfig {
	/** Folder of the config file, relative to the project root. */
	dir: string;
	/** Folder `baseUrl` points to, when the config (or one it extends) sets it. */
	baseUrlDir?: string;
	/** Alias pattern → target patterns, already relative to the project root. */
	paths: [string, string[]][];
}

export interface WorkspacePackage {
	dir: string;
	/** Files to try for the bare package name, most likely first (extensions are added). */
	entries: string[];
	/** The `exports` field as written, for the sub-paths. */
	exports?: unknown;
}

export interface ProjectConfig {
	packages: Record<string, WorkspacePackage>;
	ts: TsConfig[];
}

export const EMPTY_CONFIG: ProjectConfig = { packages: {}, ts: [] };

/** The known file for a path without or with extension, or as a folder with index. Never `from` itself. */
export function findFile(base: string, known: ReadonlySet<string>, from?: string): string | undefined {
	const normal = posix.normalize(base);
	const stripped = normal.replace(/\.(m|c)?js$/, "");
	const candidates = [...EXTENSIONS.map((ext) => `${normal}${ext}`), ...EXTENSIONS.map((ext) => `${stripped}${ext}`), ...EXTENSIONS.map((ext) => `${normal}/index${ext}`)];
	return candidates.find((candidate) => candidate !== from && known.has(candidate));
}

/** JSON with comments and trailing commas (tsconfig style); undefined when it still does not parse. */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
	const clean = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_all, quoted: string | undefined) => quoted ?? "").replace(/,(\s*[}\]])/g, "$1");
	try {
		const value = JSON.parse(clean);
		return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** posix.join where the project root is "" (not "."). */
const join = (...parts: string[]) => {
	const joined = posix.join(...parts);
	return joined === "." ? "" : joined;
};

const asRecord = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

function readTsConfig(path: string, read: (path: string) => string | undefined, packages: Record<string, WorkspacePackage>, depth = 0): { baseUrlDir?: string; paths: [string, string[]][]; references: string[] } | undefined {
	const json = parseJsonc(read(path) ?? "");
	if (!json) return undefined;
	const dir = dirname(path) === "." ? "" : dirname(path);
	let inherited: { baseUrlDir?: string; paths: [string, string[]][] } = { paths: [] };
	const references = (Array.isArray(json.references) ? json.references : []).map((reference) => asRecord(reference)?.path).filter((target): target is string => typeof target === "string").map((target) => (target.endsWith(".json") ? join(dir, target) : join(dir, target, "tsconfig.json")));
	if (typeof json.extends === "string" && depth < 5) {
		const spec = json.extends;
		const target = spec.startsWith(".") ? join(dir, spec.endsWith(".json") ? spec : `${spec}.json`) : extendsPackage(spec, packages, read);
		if (target) inherited = readTsConfig(target, read, packages, depth + 1) ?? inherited;
	}
	const options = asRecord(json.compilerOptions) ?? {};
	const baseUrlDir = typeof options.baseUrl === "string" ? join(dir, options.baseUrl) : inherited.baseUrlDir;
	const declared = asRecord(options.paths);
	if (!declared) return { baseUrlDir, paths: inherited.paths, references };
	const root = baseUrlDir ?? dir;
	const paths = Object.entries(declared).map(([pattern, targets]): [string, string[]] => [pattern, (Array.isArray(targets) ? targets : []).filter((target): target is string => typeof target === "string").map((target) => join(root, target))]);
	return { baseUrlDir, paths, references };
}

/** Conditions tried first; any other condition ("my-company", "browser") comes after them, in the order written. */
const CONDITIONS = new Set(["types", "import", "default", "require", "node", "module", "source"]);

/** Targets of one `exports` value, in order: a string, the first usable branch of an array, the accepted conditions of an object. */
function exportTargets(value: unknown, captured: string): string[] {
	if (typeof value === "string") return [value.replaceAll("*", captured)];
	if (Array.isArray(value)) return value.flatMap((item) => exportTargets(item, captured));
	const record = asRecord(value);
	if (!record) return [];
	const entries = Object.entries(record);
	return [...entries.filter(([condition]) => CONDITIONS.has(condition)), ...entries.filter(([condition]) => !CONDITIONS.has(condition))].flatMap(([, branch]) => exportTargets(branch, captured));
}

/**
 * Files a sub-path ("." or "./button") of a package can point to through its `exports` map: exact keys first, then the
 * longest `*` pattern. Targets in a build folder ("./dist/x.js") also give the source twin ("src/x"), since only
 * sources are in the graph. Paths are relative to the package folder.
 */
export function exportsTargets(exported: unknown, subpath: string): string[] {
	if (exported === undefined || exported === null) return [];
	const record = asRecord(exported);
	const isMap = !!record && Object.keys(record).some((key) => key.startsWith("."));
	let targets: string[] = [];
	if (!isMap) targets = subpath === "." ? exportTargets(exported, "") : [];
	else if (subpath in record!) targets = exportTargets(record![subpath], "");
	else {
		const patterns = Object.keys(record!).filter((key) => key.includes("*") && matches(key, subpath) !== undefined).sort((a, b) => b.indexOf("*") - a.indexOf("*"));
		const folder = Object.keys(record!).filter((key) => key.endsWith("/") && subpath.startsWith(key)).sort((a, b) => b.length - a.length)[0];
		if (patterns.length) targets = exportTargets(record![patterns[0]], matches(patterns[0], subpath)!);
		else if (folder) targets = exportTargets(record![folder], "").map((target) => `${target}${subpath.slice(folder.length)}`);
	}
	return targets.flatMap((target) => [target, target.replace(/^(\.\/)?(dist|build|out|lib)\//, "src/")]);
}

function packageEntries(dir: string, json: Record<string, unknown>): string[] {
	const fields: unknown[] = [json.source, json.types, json.typings, json.module, json.main];
	const fromExports = exportsTargets(json.exports, ".");
	return [...fromExports, ...fields.filter((field): field is string => typeof field === "string")].map((field) => join(dir, field)).concat(join(dir, "src/index"), join(dir, "index"));
}

/** The config file an `extends` points to when it names a workspace package ("@acme/tsconfig/base.json"). */
function extendsPackage(spec: string, packages: Record<string, WorkspacePackage>, read: (path: string) => string | undefined): string | undefined {
	const name = Object.keys(packages).filter((candidate) => spec === candidate || spec.startsWith(`${candidate}/`)).sort((a, b) => b.length - a.length)[0];
	if (!name) return undefined;
	const pkg = packages[name];
	const rest = spec.slice(name.length + 1);
	const candidates = rest
		? [...exportsTargets(pkg.exports, `./${rest}`).map((target) => join(pkg.dir, target)), join(pkg.dir, rest), join(pkg.dir, `${rest}.json`)]
		: [join(pkg.dir, "tsconfig.json")];
	return candidates.find((candidate) => /\.json$/.test(candidate) && read(candidate) !== undefined);
}

/** The workspace packages and tsconfig aliases of a project, from the list of its files. */
export function readProjectConfig(files: string[], read: (path: string) => string | undefined): ProjectConfig {
	const config: ProjectConfig = { packages: {}, ts: [] };
	// Packages first: a tsconfig can extend a config that lives in one of them.
	for (const path of files) {
		if (posix.basename(path) !== "package.json") continue;
		const dir = dirname(path) === "." ? "" : dirname(path);
		const json = parseJsonc(read(path) ?? "");
		if (json && typeof json.name === "string" && json.name && !config.packages[json.name]) config.packages[json.name] = { dir, entries: packageEntries(dir, json), exports: json.exports };
	}
	// Configs named like tsconfig*.json or jsconfig*.json, plus any file a `references` entry points to (any name).
	const queue = files.filter((path) => /^(ts|js)config(\.[\w-]+)?\.json$/.test(posix.basename(path)));
	const seen = new Set(queue);
	for (let index = 0; index < queue.length; index++) {
		const path = queue[index];
		const dir = dirname(path) === "." ? "" : dirname(path);
		const parsed = readTsConfig(path, read, config.packages);
		if (!parsed) continue;
		if (parsed.baseUrlDir !== undefined || parsed.paths.length) config.ts.push({ dir, baseUrlDir: parsed.baseUrlDir, paths: parsed.paths });
		for (const reference of parsed.references) if (!seen.has(reference) && read(reference) !== undefined) {
			seen.add(reference);
			queue.push(reference);
		}
	}
	// Deepest folder first, the plain tsconfig.json before variants such as tsconfig.build.json.
	config.ts.sort((a, b) => b.dir.length - a.dir.length || a.dir.localeCompare(b.dir));
	return config;
}

const matches = (pattern: string, spec: string): string | undefined => {
	const star = pattern.indexOf("*");
	if (star < 0) return pattern === spec ? "" : undefined;
	const head = pattern.slice(0, star);
	const tail = pattern.slice(star + 1);
	return spec.startsWith(head) && spec.endsWith(tail) && spec.length >= head.length + tail.length ? spec.slice(head.length, spec.length - tail.length) : undefined;
};

const inside = (dir: string, path: string) => dir === "" || path === dir || path.startsWith(`${dir}/`);

/** The project file a non-relative TS/JS specifier points to through aliases or workspace packages. */
export function resolveBare(from: string, spec: string, known: ReadonlySet<string>, config: ProjectConfig): string | undefined {
	for (const ts of config.ts) {
		if (!inside(ts.dir, from)) continue;
		for (const [pattern, targets] of ts.paths) {
			const captured = matches(pattern, spec);
			if (captured === undefined) continue;
			for (const target of targets) {
				const found = findFile(target.replaceAll("*", captured), known, from);
				if (found) return found;
			}
		}
		if (ts.baseUrlDir !== undefined) {
			const found = findFile(join(ts.baseUrlDir, spec), known, from);
			if (found) return found;
		}
	}
	const names = Object.keys(config.packages).filter((name) => spec === name || spec.startsWith(`${name}/`)).sort((a, b) => b.length - a.length);
	for (const name of names) {
		const pkg = config.packages[name];
		const rest = spec.slice(name.length + 1);
		const bases = rest ? [...exportsTargets(pkg.exports, `./${rest}`).map((target) => join(pkg.dir, target)), join(pkg.dir, rest), join(pkg.dir, "src", rest)] : pkg.entries;
		for (const base of bases) {
			const found = findFile(base, known, from);
			if (found) return found;
		}
	}
	return undefined;
}
