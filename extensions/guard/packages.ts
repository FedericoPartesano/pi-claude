/**
 * Packages about to be installed that look risky (from claude-mods' supply-chain-defense, behavioural first): a name
 * missing from the registry (a model-invented name someone may register: "slopsquatting"), a package published days
 * ago, or one named like a popular package without being it. Checked before the install runs (install scripts run at
 * once); a registry that does not answer stays silent.
 */
export interface Install {
	ecosystem: "npm" | "pypi";
	name: string;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

const NPM_CLIENTS = /^(npm|pnpm|yarn|bun)$/;
const NPM_VERBS = new Set(["i", "install", "add"]);
/** Options whose next word is their value, not a package. */
const VALUE_FLAGS = new Set(["-r", "-c", "-e", "--requirement", "--constraint", "--editable", "-w", "--workspace", "--prefix", "--tag", "--registry", "-C", "--cwd", "--filter", "-F", "-t", "--target", "-i", "--index-url", "--extra-index-url", "--group", "-G", "--python", "-p", "--source", "--save-prefix"]);

/** One shell command at a time (split on && ; |), the installer word first. */
export function parseInstalls(command: string): Install[] {
	const out: Install[] = [];
	// Separators inside quotes are text (a commit message mentioning "npm install x"), not commands.
	const unquoted = command.replace(/"[^"]*"|'[^']*'/g, (quoted) => quoted.replace(/[;&|\n]/g, " "));
	for (const part of unquoted.split(/&&|\|\||;|\||\n/)) {
		const words = part.trim().match(/'[^']*'|"[^"]*"|\S+/g)?.map((word) => word.replace(/^['"]|['"]$/g, "")) ?? [];
		if (words.length < 2) continue;
		const [tool, verb, ...rest] = words;
		let ecosystem: Install["ecosystem"] | undefined;
		let args: string[] = [];
		if (NPM_CLIENTS.test(tool) && NPM_VERBS.has(verb)) [ecosystem, args] = ["npm", rest];
		else if (/^pip3?$/.test(tool) && verb === "install") [ecosystem, args] = ["pypi", rest];
		else if (tool === "uv" && verb === "add") [ecosystem, args] = ["pypi", rest];
		else if (tool === "uv" && verb === "pip" && rest[0] === "install") [ecosystem, args] = ["pypi", rest.slice(1)];
		else if (tool === "poetry" && verb === "add") [ecosystem, args] = ["pypi", rest];
		if (!ecosystem) continue;
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (VALUE_FLAGS.has(arg)) {
				i++; // its value is a file, a folder, a tag: not a package
				continue;
			}
			// Flags, paths, URLs, archives, protocol specs (github:, file:, workspace:) and npm's owner/repo shorthand.
			if (arg.startsWith("-") || /^[./~]|:|^git\+|\.(tgz|whl|tar\.gz)$/.test(arg) || (ecosystem === "npm" && !arg.startsWith("@") && arg.includes("/"))) continue;
			const name = ecosystem === "npm" ? arg.replace(/(.)@.*$/, "$1") : arg.replace(/[\[<>=!~;].*$/, "");
			if (name) out.push({ ecosystem, name: name.toLowerCase() });
		}
	}
	return out;
}

/** Popular packages that typosquatters imitate (a short list: the ones agents install most). */
const POPULAR: Record<Install["ecosystem"], string[]> = {
	npm: "react react-dom lodash express axios typescript vue next zod chalk commander dotenv uuid moment dayjs jest vitest webpack vite eslint prettier tailwindcss prisma mongoose redux rxjs jquery underscore async debug request body-parser cors yargs inquirer glob rimraf mkdirp semver ws socket.io jsonwebtoken bcrypt bcryptjs nodemon ts-node esbuild rollup babel-core @babel/core @types/node sass postcss autoprefixer cheerio puppeteer playwright sharp pg mysql2 sqlite3 redis ioredis knex sequelize typeorm graphql apollo-server nestjs @nestjs/core fastify koa hono undici node-fetch cross-env concurrently date-fns luxon immer zustand swr formik yup joi ajv nanoid classnames clsx framer-motion three d3 chart.js".split(" "),
	pypi: "requests numpy pandas scipy matplotlib flask django fastapi uvicorn pydantic sqlalchemy boto3 pytest setuptools wheel pip six urllib3 certifi idna charset-normalizer python-dateutil pyyaml jinja2 click rich httpx aiohttp beautifulsoup4 lxml pillow scikit-learn tensorflow torch transformers openai anthropic langchain celery redis psycopg2 psycopg2-binary pymongo selenium playwright black ruff mypy tqdm colorama cryptography paramiko jsonschema toml tomli attrs typing-extensions".split(" "),
};

/** A well-known package: nothing to look up (and no multi-MB packument to download). */
export const isPopular = (install: Install) => POPULAR[install.ecosystem].includes(install.name);

/** Damerau–Levenshtein distance (adjacent swaps count 1), stopping early past `limit`. */
function distance(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	}
	return d[a.length][b.length];
}

/**
 * The popular package this name imitates, or undefined. Long names (8+): one edit. Short ones (5–7): only a swap or a
 * changed letter, same length — a letter more or less is too often a real, different package (preact, boto, jinja).
 */
export function looksLike(name: string, ecosystem: Install["ecosystem"]): string | undefined {
	const list = POPULAR[ecosystem];
	if (list.includes(name)) return undefined;
	const plain = (value: string) => value.replace(/[-_.]/g, "");
	return list.find((popular) => {
		if (plain(popular) === plain(name)) return popular !== name && name.length > 3; // python-dateutil vs python_dateutil is fine on pypi
		if (popular.length >= 8) return distance(name, popular, 1) <= 1;
		return popular.length >= 5 && name.length === popular.length && distance(name, popular, 1) <= 1;
	});
}

/** Whether the package comes from a registry other than the public one (.npmrc scopes or registry, a pip index): never looked up there. */
export function privateRegistry(install: Install, project: string, home: string, env: NodeJS.ProcessEnv = process.env): boolean {
	if (install.ecosystem === "pypi") return Boolean(env.PIP_INDEX_URL || env.UV_INDEX_URL || env.UV_DEFAULT_INDEX || env.POETRY_REPOSITORIES_DEFAULT_URL);
	const scope = install.name.startsWith("@") ? install.name.split("/")[0] : undefined;
	for (const dir of [project, home]) {
		let npmrc = "";
		try {
			npmrc = readFileSync(join(dir, ".npmrc"), "utf8");
		} catch {
			continue;
		}
		for (const line of npmrc.split("\n")) {
			const match = /^\s*(@[\w.-]+:)?registry\s*=\s*(\S+)/.exec(line);
			if (!match) continue;
			if (match[1] ? match[1].slice(0, -1) === scope : !/registry\.npmjs\.org/.test(match[2])) return true;
		}
	}
	return Boolean(env.npm_config_registry && !/registry\.npmjs\.org/.test(env.npm_config_registry));
}

export interface RegistryInfo {
	found: boolean;
	/** First publication (ISO). */
	created?: string;
}

const NEW_DAYS = 30;

/** Why this install deserves a second look, or undefined. `info` undefined = the registry did not answer. */
export function assessPackage(install: Install, info: RegistryInfo | undefined, now = Date.now()): string | undefined {
	const lookalike = looksLike(install.name, install.ecosystem);
	if (lookalike && install.ecosystem === "pypi" && lookalike.replace(/[-_.]/g, "") === install.name.replace(/[-_.]/g, "")) return undefined;
	if (!info) return lookalike ? `«${install.name}» somiglia a «${lookalike}» (typosquatting?)` : undefined;
	if (!info.found) return `«${install.name}» non esiste su ${install.ecosystem === "npm" ? "npm" : "PyPI"}: nome sbagliato o inventato (chi lo registra dopo può pubblicarci codice malevolo)`;
	if (lookalike) return `«${install.name}» somiglia a «${lookalike}» (typosquatting?)`;
	if (info.created) {
		const days = Math.floor((now - Date.parse(info.created)) / 86_400_000);
		if (days >= 0 && days < NEW_DAYS) return `«${install.name}» è stato pubblicato ${days} giorni fa (i pacchetti malevoli si diffondono prima delle segnalazioni)`;
	}
	return undefined;
}

/** First publication of a package from its registry (npm, PyPI), with a short timeout. */
export async function registryInfo(install: Install, fetcher: typeof fetch = fetch, timeoutMs = 2500): Promise<RegistryInfo | undefined> {
	const url = install.ecosystem === "npm" ? `https://registry.npmjs.org/${install.name.replace("/", "%2F")}` : `https://pypi.org/pypi/${encodeURIComponent(install.name)}/json`;
	try {
		const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
		if (response.status === 404) return { found: false };
		if (!response.ok) return undefined;
		const body = (await response.json()) as { time?: { created?: string }; releases?: Record<string, { upload_time_iso_8601?: string }[]> };
		if (install.ecosystem === "npm") return { found: true, created: body.time?.created };
		const uploads = Object.values(body.releases ?? {}).flat().map((file) => file.upload_time_iso_8601 ?? "").filter(Boolean).sort();
		return { found: true, created: uploads[0] };
	} catch {
		return undefined; // offline or slow: silent
	}
}
