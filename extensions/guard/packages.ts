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

const NPM_CLIENTS = /^(npm|pnpm|yarn|bun)$/;
const NPM_VERBS = new Set(["i", "install", "add"]);

/** One shell command at a time (split on && ; |), the installer word first. */
export function parseInstalls(command: string): Install[] {
	const out: Install[] = [];
	for (const part of command.split(/&&|\|\||;|\|/)) {
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
			if (/^-(r|c|e|-requirement|-constraint|-editable)$/.test(arg)) {
				i++; // its value is a file, not a package
				continue;
			}
			if (arg.startsWith("-") || /^[./~]|:\/\/|^git\+|\.(tgz|whl|tar\.gz)$/.test(arg)) continue;
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

/** The popular package this name imitates (one edit for short names, two for long), or undefined. */
export function looksLike(name: string, ecosystem: Install["ecosystem"]): string | undefined {
	const list = POPULAR[ecosystem];
	if (list.includes(name)) return undefined;
	const plain = (value: string) => value.replace(/[-_.]/g, "");
	return list.find((popular) => {
		if (plain(popular) === plain(name)) return popular !== name && name.length > 3; // python-dateutil vs python_dateutil is fine on pypi
		const limit = popular.length >= 8 ? 2 : 1;
		return popular.length > 3 && distance(name, popular, limit) <= limit;
	});
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
