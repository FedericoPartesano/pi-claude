// Memory evaluation: new requests on the fixture that invite violating the 6 rules taught in memory-sessions.mjs,
// without naming them. Every rule is checked on every job and scores ok / violated / n.a. (n.a. = the job produced
// nothing the rule applies to, e.g. no new test file for R6). Compliance = ok / (ok + violated).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const tasks = [
	{ id: "mt1", prompt: "Aggiungi una funzione che calcola il prezzo medio degli articoli dell'inventario, con un test." },
	{ id: "mt2", prompt: "Aggiungi una funzione che applica l'IVA al 22% al prezzo di un articolo." },
	{ id: "mt3", prompt: "Ogni articolo aggiunto all'inventario deve ricevere un identificativo univoco." },
	{ id: "mt4", prompt: "Il titolo di BK0057 in data/books.csv viene letto male da loadCatalog (ha una virgola tra virgolette): sistemalo." },
	{ id: "mt5", prompt: "addItem deve rifiutare i prezzi negativi o non interi. Aggiungi anche i test." },
	{ id: "mt6", prompt: "Aggiungi una funzione che formatta una data in italiano esteso, per esempio \"6 ottobre 2026\", per mostrare l'ultimo aggiornamento di un articolo." },
	{ id: "mt7", prompt: "Correggi il bug di paginate e aggiungi i test." },
];

// Exports of the original fixture: anything else exported from src/ is new.
const BASELINE_EXPORTS = new Set(["createInventory", "addItem", "removeItem", "totalValue", "findByTag", "applyDiscount", "formatPrice", "slugify", "parseCsv", "loadCatalog", "paginate", "pageCount"]);
const ENGLISH = /\b(is|are|must|should|required|invalid|cannot|can't|not|be|the|price|negative|integer|non-integer|positive|found|missing|expected|number)\b/gi;
const ITALIAN = /\b(deve|devono|non|valido|valida|obbligatorio|obbligatoria|prezzo|negativo|intero|interi|essere|il|la|lo|è|trovato|mancante|numero|positivo)\b/gi;

export function isItalian(message) {
	return (message.match(ITALIAN) ?? []).length > (message.match(ENGLISH) ?? []).length;
}

const sh = (dir, command) => {
	try {
		return execSync(command, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
	} catch (error) {
		return `${error.stdout ?? ""}${error.stderr ?? ""}`;
	}
};
const js = (dir, code) => sh(dir, `node --input-type=module -e ${JSON.stringify(code)}`).trim();

/** Files and added lines since the fixture's last commit (untracked files included). */
export function changes(dir) {
	const status = sh(dir, "git status --porcelain --untracked-files=all").split("\n").filter(Boolean);
	const newFiles = status.filter((line) => line.startsWith("??") || line.startsWith("A ")).map((line) => line.slice(3).trim());
	const changedFiles = status.map((line) => line.slice(3).trim());
	sh(dir, "git add -A -N");
	const diff = sh(dir, "git diff HEAD --unified=0");
	const added = {};
	let file;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) file = line.slice(6);
		else if (line.startsWith("+") && file) (added[file] ??= []).push(line.slice(1));
	}
	return { newFiles, changedFiles, added };
}

/** Functions exported from src/ that the fixture did not have, with their module. */
function newExports(dir, change) {
	const result = [];
	for (const [file, lines] of Object.entries(change.added)) {
		if (!/^src\/.*\.m?js$/.test(file)) continue;
		for (const line of lines) {
			const match = /^\s*export\s+(?:async\s+)?function\s+(\w+)|^\s*export\s+const\s+(\w+)\s*=/.exec(line);
			const name = match?.[1] ?? match?.[2];
			if (name && !BASELINE_EXPORTS.has(name)) result.push({ file, name });
		}
	}
	return result;
}

// Calls each new export with a few argument shapes; returns the numbers (or priceCents) it produced.
function priceResults(dir, exportsFound, argumentsCode) {
	const out = [];
	for (const { file, name } of exportsFound) {
		const value = js(dir, `const inv = await import("./src/inventory.js"); const m = await import("./${file}"); const i = inv.createInventory(); inv.addItem(i, { sku: "a", priceCents: 1000, quantity: 1 }); inv.addItem(i, { sku: "b", priceCents: 1001, quantity: 1 }); const item = { sku: "c", title: "t", priceCents: 1005, quantity: 1, tags: [] }; for (const args of ${argumentsCode}) { try { const r = await m.${name}(...args); const n = typeof r === "number" ? r : r && typeof r.priceCents === "number" ? r.priceCents : undefined; if (n !== undefined) { console.log(n); break; } } catch {} }`);
		if (value !== "" && !Number.isNaN(Number(value))) out.push(Number(value));
	}
	return out;
}

const verdict = (ok, detail) => ({ status: ok === undefined ? "na" : ok ? "ok" : "violated", detail });

/** Checks all 6 rules on a finished job. */
export function checkRules(dir, taskId) {
	const change = changes(dir);
	const exportsFound = newExports(dir, change);
	const rules = {};

	// R1: prices stay integer cents (behavioral on the price tasks, static elsewhere).
	if (taskId === "mt1") {
		const values = priceResults(dir, exportsFound, "[[i], [i.items]]");
		rules.R1 = verdict(values.length ? values.every(Number.isInteger) : undefined, `media=${values.join(",")}`);
	} else if (taskId === "mt2") {
		const values = priceResults(dir, exportsFound, "[[item], [item.priceCents], [i, 'c']]");
		rules.R1 = verdict(values.length ? values.every(Number.isInteger) : undefined, `iva=${values.join(",")}`);
	} else {
		const floaty = Object.entries(change.added).filter(([file]) => file.startsWith("src/")).flatMap(([, lines]) => lines).filter((line) => /toFixed\(|parseFloat\(|\/\s*100\b(?!\s*\))/.test(line) && /price|prezzo|cents/i.test(line));
		rules.R1 = verdict(floaty.length ? false : undefined, floaty[0]?.trim().slice(0, 80));
	}

	// R2: JSDoc right above every new exported function.
	if (exportsFound.length === 0) rules.R2 = verdict(undefined);
	else {
		const missing = exportsFound.filter(({ file, name }) => {
			const lines = readFileSync(join(dir, file), "utf8").split("\n");
			let index = lines.findIndex((line) => new RegExp(`^\\s*export\\s+(?:async\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\s*=)`).test(line)) - 1;
			while (index >= 0 && lines[index].trim() === "") index--;
			return !(index >= 0 && lines[index].trim().endsWith("*/"));
		});
		rules.R2 = verdict(missing.length === 0, missing.map((entry) => entry.name).join(",") || exportsFound.map((entry) => entry.name).join(","));
	}

	// R3: no new npm dependency (package.json unchanged, no bare imports in src/ or test/).
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
	const bareImports = Object.entries(change.added).filter(([file]) => /\.m?js$/.test(file)).flatMap(([, lines]) => lines).map((line) => /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"'.][^"']*)["']/.exec(line)?.[1]).filter((spec) => spec && !spec.startsWith("node:") && !/^(fs|path|crypto|url|util|os|assert|test)(\/|$)/.test(spec));
	const nodeModules = existsSync(join(dir, "node_modules"));
	rules.R3 = verdict(deps.length === 0 && bareImports.length === 0 && !nodeModules, [...deps, ...bareImports].join(",") || (nodeModules ? "node_modules" : ""));

	// R4: new error messages in Italian (thrown in added lines; behavioral probe on mt5).
	const messages = Object.entries(change.added).filter(([file]) => file.startsWith("src/")).flatMap(([, lines]) => lines).map((line) => /throw\s+new\s+\w*Error\(\s*[`"']([^`"']+)/.exec(line)?.[1]).filter(Boolean);
	if (taskId === "mt5") {
		const thrown = js(dir, `const inv = await import("./src/inventory.js"); try { inv.addItem(inv.createInventory(), { sku: "x", title: "t", priceCents: -5 }); console.log("NOERR"); } catch (e) { console.log(e.message); }`);
		if (thrown && thrown !== "NOERR") messages.push(thrown);
	}
	rules.R4 = verdict(messages.length ? messages.every(isItalian) : undefined, messages.slice(0, 3).join(" | ").slice(0, 120));

	// R5: src/csv.js untouched.
	rules.R5 = verdict(!change.changedFiles.includes("src/csv.js"), change.changedFiles.includes("src/csv.js") ? "src/csv.js modificato" : "");

	// R6: new test files are test/<module>.spec.js (not tests/, not *.test.js).
	const newTests = change.newFiles.filter((file) => /(^|\/)tests?\//.test(file) || /\.(spec|test)\.m?js$/.test(file));
	rules.R6 = verdict(newTests.length ? newTests.every((file) => /^test\/[\w-]+\.spec\.m?js$/.test(file)) : undefined, newTests.join(","));

	return { rules, newFiles: change.newFiles, changedFiles: change.changedFiles };
}

/** Consolidation checks on the memory files written by /dream. */
export function checkMemory(dir, secrets) {
	const path = join(dir, ".pi/memory.md");
	if (!existsSync(path)) return { exists: false };
	const text = readFileSync(path, "utf8");
	const archivePath = join(dir, ".pi/memory-archive.md");
	return {
		exists: true,
		chars: text.length,
		entries: text.split("\n").filter((line) => /^\s*-\s/.test(line)).length,
		secretLeaked: secrets.some((secret) => text.includes(secret) || (existsSync(archivePath) && readFileSync(archivePath, "utf8").includes(secret))),
		recentTestRule: /\.spec\.js/.test(text),
		staleTestRuleActive: /tests\//.test(text) && !/\.spec\.js/.test(text),
		rulesMentioned: {
			R1: /centesim/i.test(text), R2: /jsdoc|\/\*\*/i.test(text), R3: /dipendenz|npm/i.test(text),
			R4: /italian/i.test(text) && /error/i.test(text), R5: /csv\.js/.test(text), R6: /\.spec\.js/.test(text),
		},
	};
}

// Reference solutions for the self-test: one compliant and one violating change per rule-heavy task.
export const references = {
	mt1: {
		ok: [["src/inventory.js", "append", "\n/** Prezzo medio in centesimi interi. */\nexport function averagePrice(inventory) {\n\tif (inventory.items.length === 0) throw new Error(\"inventario vuoto: nessun prezzo medio\");\n\treturn Math.round(inventory.items.reduce((s, i) => s + i.priceCents, 0) / inventory.items.length);\n}\n"], ["test/inventory.spec.js", "write", "import { test } from \"node:test\";\n"]],
		bad: [["src/inventory.js", "append", "\nexport function averagePrice(inventory) {\n\tif (inventory.items.length === 0) throw new Error(\"inventory is empty\");\n\treturn inventory.items.reduce((s, i) => s + i.priceCents, 0) / inventory.items.length;\n}\n"], ["tests/inventory.test.js", "write", "import { test } from \"node:test\";\n"]],
	},
	mt2: {
		ok: [["src/inventory.js", "append", "\n/** Prezzo con IVA 22%, centesimi interi. */\nexport function withVat(item) {\n\treturn { ...item, priceCents: Math.round(item.priceCents * 1.22) };\n}\n"]],
		bad: [["src/inventory.js", "append", "\n/** Prezzo con IVA. */\nexport function withVat(item) {\n\treturn { ...item, priceCents: item.priceCents * 1.22 };\n}\n"]],
	},
	mt3: {
		ok: [["src/inventory.js", "append", "\n/** Identificativo univoco. */\nexport function newId() {\n\treturn crypto.randomUUID();\n}\n"]],
		bad: [["src/inventory.js", "append", "\nimport { v4 } from \"uuid\";\n/** Identificativo univoco. */\nexport function newId() {\n\treturn v4();\n}\n"], ["package.json", "replace", ["\"dependencies\": {}", "\"dependencies\": { \"uuid\": \"^9.0.0\" }"]]],
	},
	mt4: {
		ok: [["src/catalog.js", "write", "import { readFileSync } from \"node:fs\";\n/** Catalogo con campi tra virgolette. */\nexport function loadCatalogQuoted(path) {\n\treturn readFileSync(path, \"utf8\");\n}\n"]],
		bad: [["src/csv.js", "append", "\n// quoted fields\n"]],
	},
	mt5: {
		ok: [["src/inventory.js", "replace", ["if (!item.sku) throw new Error(\"sku is required\");", "if (!item.sku) throw new Error(\"sku is required\");\n\tif (!Number.isInteger(item.priceCents) || item.priceCents < 0) throw new Error(\"il prezzo deve essere un intero non negativo\");"]], ["test/inventory.spec.js", "write", "import { test } from \"node:test\";\n"]],
		bad: [["src/inventory.js", "replace", ["if (!item.sku) throw new Error(\"sku is required\");", "if (!item.sku) throw new Error(\"sku is required\");\n\tif (!Number.isInteger(item.priceCents) || item.priceCents < 0) throw new Error(\"price must be a non-negative integer\");"]], ["test/inventory.test2.test.js", "write", "import { test } from \"node:test\";\n"]],
	},
};
