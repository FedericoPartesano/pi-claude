// Round-2 memory arm on the yaml repo: 6 rules the code does not reveal, how they are taught, and how they are checked.
// Every check returns "ok", "violated" or "na" (the change has nothing the rule applies to).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isItalian } from "../memory-cases.mjs";

/** yaml commit of the memory arm, pinned so resumed runs work on the same code. */
export const MEMORY_BASE = "528ef30d6ded4bd9f2c3521b670eb2b29d503c5c";

const inSource = (file) => file.path.startsWith("src/");
// yaml's tests are tests/*.ts, without a .test. suffix.
const isTest = (file) => file.path.startsWith("tests/") || /\.test\.[cm]?[jt]s$/.test(file.path);

export const RULES = [
	{ id: "R1", text: "I messaggi di errore nuovi vanno scritti in italiano.", check: (_dir, { files }) => {
		const messages = files.flatMap((file) => file.added).map((line) => /new \w*Error\(\s*["'`](.+?)["'`]/.exec(line)?.[1]).filter(Boolean);
		return !messages.length ? "na" : messages.every(isItalian) ? "ok" : "violated";
	} },
	{ id: "R2", text: "Ogni funzione esportata nuova ha un commento JSDoc /** … */ subito sopra.", check: (_dir, { files }) => {
		let state = "na";
		for (const file of files.filter(inSource)) file.added.forEach((line, index) => {
			if (!/^\s*export (async )?function /.test(line)) return;
			if (!/\*\/\s*$/.test(file.added[index - 1] ?? "")) state = "violated";
			else if (state === "na") state = "ok";
		});
		return state;
	} },
	{ id: "R3", text: "Non aggiungere dipendenze nuove in package.json.", check: (dir, { base = "HEAD" } = {}) => {
		if (!dir) return "na";
		const before = JSON.parse(execSync(`git show ${base}:package.json`, { cwd: dir, encoding: "utf8" }));
		const after = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		const keys = (pkg) => JSON.stringify([Object.keys(pkg.dependencies ?? {}).sort(), Object.keys(pkg.devDependencies ?? {}).sort()]);
		return keys(before) === keys(after) ? "ok" : "violated";
	} },
	{ id: "R4", text: "I test nuovi vanno in un file nuovo tests/<nome>.round2.test.ts, mai in file di test esistenti.", check: (_dir, { files, newFiles = [] }) => {
		const tests = files.filter(isTest).filter((file) => file.added.some((line) => /\b(test|it)\(/.test(line)));
		if (!tests.length) return "na";
		return tests.every((file) => newFiles.includes(file.path) && /^tests\/.+\.round2\.test\.ts$/.test(file.path)) ? "ok" : "violated";
	} },
	{ id: "R5", text: "Ogni modifica aggiunge una riga in CHANGES-local.md che inizia con - [AAAA-MM-GG].", check: (_dir, { files }) => {
		if (!files.some((file) => file.path !== "CHANGES-local.md")) return "na";
		return files.some((file) => file.path === "CHANGES-local.md" && file.added.some((line) => /^- \[\d{4}-\d{2}-\d{2}\] /.test(line))) ? "ok" : "violated";
	} },
	{ id: "R6", text: "Niente console.log nel codice sorgente.", check: (_dir, { files }) => {
		const source = files.filter(inSource);
		if (!source.length) return "na";
		return source.some((file) => file.added.some((line) => /console\.log\(/.test(line))) ? "violated" : "ok";
	} },
];

/** The agents' own memory (Pi's .pi/, a project CLAUDE.md or AGENTS.md) and the eval's marker are not changes. */
export const isMemoryFile = (path) => path.startsWith(".pi/") || path === ".pi-eval-taught" || path === "CLAUDE.md" || path === "AGENTS.md";

/** Lines added since `base` (commits of the agent included), untracked files included, memory files excluded. */
export function changes(dir, base = "HEAD") {
	const run = (command) => execSync(command, { cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	const newFiles = run("git ls-files --others --exclude-standard").trim().split("\n").filter((path) => path && !isMemoryFile(path));
	const files = [];
	let current;
	for (const line of run(`git diff ${base} --unified=0`).split("\n")) {
		const header = /^\+\+\+ b\/(.*)$/.exec(line);
		if (header) {
			current = isMemoryFile(header[1]) ? undefined : { path: header[1], added: [] };
			if (current) files.push(current);
		}
		else if (current && line.startsWith("+") && !line.startsWith("+++")) current.added.push(line.slice(1));
	}
	for (const path of newFiles) files.push({ path, added: readFileSync(join(dir, path), "utf8").split("\n") });
	return { files, newFiles, base };
}

/** Teaching sessions: a small task; if the result breaks one of its rules, the simulated user corrects the agent once. */
export const TEACH = [
	{ prompt: "Aggiungi in src/ una funzione esportata isScalarString(value) che dice se un nodo è uno scalare di tipo stringa, con un test.", rules: ["R2", "R4", "R5", "R6"] },
	{ prompt: "Fai in modo che parse lanci un errore chiaro se riceve qualcosa che non è una stringa.", rules: ["R1", "R5", "R6"] },
	{ prompt: "Aggiungi una funzione esportata countKeys(doc) che conta le chiavi di primo livello di un documento, con test.", rules: ["R2", "R3", "R4", "R5"] },
	{ prompt: "Per debug stampa i token che il lexer produce quando la variabile d'ambiente YAML_DEBUG è impostata.", rules: ["R5", "R6"] },
	{ prompt: "Aggiungi la validazione delle opzioni di stringify: indent deve essere un intero positivo, altrimenti errore. Con test.", rules: ["R1", "R4", "R5"] },
	{ prompt: "Serve un modo per confrontare due documenti YAML ignorando l'ordine delle chiavi: aggiungilo, puoi usare una libreria se aiuta.", rules: ["R2", "R3", "R5"] },
];

/** New tasks in a clean session: they invite breaking the rules without naming them. */
export const TASKS = [
	{ id: "m1", prompt: "Aggiungi una funzione esportata che restituisce la profondità massima di annidamento di un documento, con un test." },
	{ id: "m2", prompt: "parseDocument deve rifiutare documenti più lunghi di 10 MB con un errore." },
	{ id: "m3", prompt: "Aggiungi una funzione esportata che conta gli alias (*nome) presenti in un documento, con i test." },
	{ id: "m4", prompt: "Quando la variabile d'ambiente YAML_STATS è impostata, parseAllDocuments deve stampare quanti documenti ha trovato." },
	{ id: "m5", prompt: "Mi serve una funzione che converte un documento YAML in JSON formattato, usa pure una libreria se serve." },
];
