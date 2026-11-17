// Complex-task bench: same task with and without the skill that fits it, scored by hidden criteria (code run in the
// repo) and judged blind (diff + final answer, both orders). Run: node eval/skills-router/complex.mjs [--reps 2] [--model sonnet] [--parallel 4]
// Output: complex.jsonl (runs) and complex-judge.jsonl (judgements). Work dirs: /tmp/skills-cx.
import { execSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRouter, route } from "../../extensions/skills-router.ts";
import { skillBody } from "../../extensions/skills.ts";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const reps = Number(arg("reps", 2)), model = arg("model", "sonnet"), parallel = Number(arg("parallel", 4));
const root = join(import.meta.dirname, "..", "..", "skills");
const router = loadRouter(root);
const work = join(tmpdir(), "skills-cx");
mkdirSync(work, { recursive: true });
const S = (n) => `agent-skills/skills/${n}`;
const tools = "Read,Edit,Write,Glob,Grep,Bash(npm:*),Bash(node:*),Bash(git:*),Bash(ls:*),Bash(cat:*),Bash(grep:*),Bash(wc:*),Bash(head:*),Bash(tail:*),Bash(sort:*),Bash(sed:*),Bash(find:*),Bash(diff:*)";

const mod = (file, expr) => `import("./${file}").then(async (m) => { const out = {}; const t = (k, f) => { try { out[k] = !!f(); } catch { out[k] = false; } }; ${expr}; console.log(JSON.stringify(out)); })`;
const tests = (re) => `git add -A -N . >/dev/null 2>&1; git diff 438a854 --name-only -- test | xargs -r cat 2>/dev/null | grep -Eci ${JSON.stringify(re)} || true`;

export const tasks = [
	{ id: "cx01", skills: ["debugging-and-error-recovery"],
		prompt: "Il valore totale dell'inventario non torna con le quantità e le pagine dell'elenco sembrano spostate. Indaga, correggi alla radice e dimmi cosa hai verificato.",
		criteria: (dir, js, sh) => ({
			...JSON.parse(js(mod("src/inventory.js", `const p = await import("./src/pagination.js"); t("totale con quantità", () => m.totalValue({ items: [{ priceCents: 1000, quantity: 3 }, { priceCents: 500, quantity: 2 }] }) === 4000); t("quantità assente non dà NaN", () => Number.isFinite(m.totalValue({ items: [{ priceCents: 700 }] }))); t("pagina 1 = primi elementi", () => JSON.stringify(p.paginate([1,2,3,4,5,6,7], 1, 3)) === "[1,2,3]"); t("ultima pagina", () => JSON.stringify(p.paginate([1,2,3,4,5,6,7], 3, 3)) === "[7]"); t("pagina 0 non restituisce dati sbagliati", () => { try { return p.paginate([1,2,3], 0, 2).length === 0; } catch { return true; } });`))),
			"test per paginate": Number(sh(tests("paginate")).out.trim()) > 0, "test per quantità": Number(sh(tests("quantity")).out.trim()) > 0 }) },
	{ id: "cx02", skills: ["spec-driven-development", "test-driven-development"],
		prompt: "Aggiungi in src/inventory.js la funzione searchByTitle(inventory, query, page, size): ricerca per titolo. Il catalogo è in italiano e gli utenti scrivono come capita. I risultati devono essere paginati come nel resto dell'app.",
		criteria: (dir, js, sh) => ({
			...JSON.parse(js(mod("src/inventory.js", `const inv = { items: [{ sku: "1", title: "Perché è così" }, { sku: "2", title: "Il Nome della Rosa" }, { sku: "3", title: "Rosa di Maggio" }, { sku: "4", title: "Altro" }] }; const L = (r) => Array.isArray(r) ? r : (r?.items ?? r?.results ?? r?.data ?? r?.rows ?? []); const s = (q, p = 1, n = 10) => L(m.searchByTitle(inv, q, p, n)).map((i) => i.sku).join(","); t("senza accenti", () => s("perche") === "1"); t("maiuscole", () => s("ROSA") === "2,3"); t("spazi attorno", () => s("  rosa  ") === "2,3"); t("pagina 1", () => s("rosa", 1, 1) === "2"); t("pagina 2", () => s("rosa", 2, 1) === "3"); t("query vuota/assente non esplode", () => { try { return Array.isArray(L(m.searchByTitle(inv, "", 1, 10))) && Array.isArray(L(m.searchByTitle(inv, undefined, 1, 10))); } catch (e) { return e instanceof Error; } });`))),
			"test aggiunti": Number(sh(tests("searchByTitle")).out.trim()) > 0, "README aggiornato": sh("git diff 438a854 -- README.md").out.includes("searchByTitle") || /ricerca/i.test(sh("git diff 438a854 -- README.md").out) }) },
	{ id: "cx03", skills: ["security-and-hardening"],
		prompt: "Aggiungi exportCsv(items) in src/csv.js: serve a produrre un file che l'ufficio acquisti aprirà con Excel. Colonne: sku,title,author,genre,priceCents,quantity.",
		criteria: (dir, js, sh) => ({
			...JSON.parse(js(mod("src/csv.js", `const row = (title) => m.exportCsv([{ sku: "S1", title, author: "A", genre: "g", priceCents: 100, quantity: 1 }]).split("\\n").slice(1).join("\\n"); t("intestazione", () => m.exportCsv([]).split("\\n")[0] === "sku,title,author,genre,priceCents,quantity"); t("virgola tra virgolette", () => row("a, b").includes('"a, b"')); t("virgolette raddoppiate", () => row('dice "ciao"').includes('"dice ""ciao"""')); t("a capo dentro il campo", () => row("a\\nb").includes('"a\\nb"')); t("formula neutralizzata", () => { const r = row("=HYPERLINK(1)"); return !/(^|,)"?=/.test(r); }); t("formula con +/-/@", () => ["+1", "-1", "@SUM(1)"].every((f) => !/(^|,)"?[=+@-]/.test(row(f).replace(/^S1,/, "")))); `))),
			"test aggiunti": Number(sh(tests("exportCsv")).out.trim()) > 0 }) },
	{ id: "cx04", skills: ["code-review-and-quality"],
		setup: (dir) => writeFileSync(join(dir, "src/discount.js"), `// Tiered discount for bulk orders and coupons
export function bulkPrice(priceCents, qty) {
	let rate = 0;
	if (qty > 10) rate = 0.05;
	if (qty > 50) rate = 0.10;
	if (qty >= 100) rate = 0.15;
	const total = priceCents * qty * (1 - rate);
	return total;
}

export function applyCoupon(order, code) {
	const coupons = { PRIMAVERA: 10, VIP: 25 };
	order.total = order.total - order.total * coupons[code] / 100;
	return order;
}
`),
		prompt: "Ho scritto src/discount.js ma non sono convinto. Fai una review seria e sistema quello che trovi.",
		criteria: (dir, js, sh) => ({
			...JSON.parse(js(mod("src/discount.js", `t("prezzo intero in centesimi", () => Number.isInteger(m.bulkPrice(999, 11))); t("quantità negativa rifiutata", () => { try { m.bulkPrice(100, -1); return false; } catch { return true; } }); t("quantità NaN rifiutata", () => { try { m.bulkPrice(100, NaN); return false; } catch { return true; } }); t("coupon sconosciuto non dà NaN", () => { try { const r = m.applyCoupon({ total: 1000 }, "NOPE"); return r.total === 1000; } catch { return true; } }); t("coupon non muta l'ordine", () => { const o = { total: 1000 }; m.applyCoupon(o, "VIP"); return o.total === 1000; }); t("coupon su centesimi interi", () => Number.isInteger(m.applyCoupon({ total: 999 }, "PRIMAVERA").total)); t("soglie coerenti (100 pezzi = sconto più alto)", () => m.bulkPrice(100, 100) <= m.bulkPrice(100, 99) * 100 / 99);`))),
			"test aggiunti": Number(sh(tests("bulkPrice|applyCoupon")).out.trim()) > 0 }) },
	{ id: "cx05", skills: ["git-workflow-and-versioning", "shipping-and-launch"],
		prompt: "Prepara la release 1.3.0: sistema versione e changelog in base a quello che è cambiato dall'ultima release, e lascia il repository pronto da pubblicare. Non fare push.",
		criteria: (dir, js, sh) => ({
			"versione 1.3.0": JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version === "1.3.0",
			"sezione 1.3.0 sopra 1.2.0": (() => { const c = readFileSync(join(dir, "CHANGELOG.md"), "utf8"); const a = c.indexOf("1.3.0"), b = c.indexOf("1.2.0"); return a >= 0 && b > a; })(),
			"nessuna modifica non committata": sh("git status --porcelain").out.trim() === "",
			"nessun test nuovo rosso (baseline: 1 rosso su totalValue)": (() => { const o = sh("npm test 2>&1").out; return Number((o.match(/ℹ fail (\d+)/) ?? [])[1] ?? 99) <= 1; })() }) },
];

function runClaude(cwd, prompt, system) {
	return new Promise((resolve) => {
		const args = ["-p", prompt, "--output-format", "json", "--model", model, "--no-session-persistence", "--permission-mode", "acceptEdits", "--allowedTools", tools, ...(system ? ["--append-system-prompt", system] : [])];
		const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";
		child.stdout.on("data", (d) => (buf += d));
		const timer = setTimeout(() => child.kill("SIGKILL"), 420_000);
		child.on("close", () => { clearTimeout(timer); try { resolve(JSON.parse(buf)); } catch { resolve({ error: buf.slice(-200) }); } });
	});
}

async function job({ task, arm, rep }) {
	const dir = join(work, `${task.id}-${arm}-${rep}`);
	rmSync(dir, { recursive: true, force: true });
	execSync(`node ${JSON.stringify(join(import.meta.dirname, "..", "fixture/build.mjs"))} ${JSON.stringify(dir)}`);
	task.setup?.(dir);
	const system = arm === "skill" ? task.skills.map((s) => skillBody(root, S(s))).join("\n\n") : undefined;
	const started = Date.now();
	const res = await runClaude(dir, task.prompt, system);
	const sh = (command) => { try { return { code: 0, out: execSync(command, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }) }; } catch (e) { return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; } };
	const js = (code) => { try { return execSync(`node --input-type=module -e ${JSON.stringify(code)}`, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).trim() || "{}"; } catch { return "{}"; } };
	let criteria;
	try { criteria = task.criteria(dir, js, sh); } catch (e) { criteria = { errore: false }; }
	const u = res.usage ?? {};
	const row = { id: task.id, arm, rep, criteria, score: Object.values(criteria).filter(Boolean).length, of: Object.keys(criteria).length, turns: res.num_turns, cost: res.total_cost_usd, outTokens: u.output_tokens, sec: Math.round((Date.now() - started) / 100) / 10, answer: (res.result ?? "").slice(0, 3000), error: res.error };
	appendFileSync(join(import.meta.dirname, "complex.jsonl"), `${JSON.stringify(row)}\n`);
	console.log(task.id, arm, rep, `${row.score}/${row.of}`, `$${(row.cost ?? 0).toFixed(2)}`, `${row.sec}s`);
}

if (import.meta.main !== false && process.argv[1]?.endsWith("complex.mjs")) {
	writeFileSync(join(import.meta.dirname, "complex.jsonl"), "");
	const jobs = [];
	for (let rep = 1; rep <= reps; rep++) for (const task of tasks) for (const arm of ["base", "skill"]) jobs.push({ task, arm, rep });
	let next = 0;
	await Promise.all(Array.from({ length: parallel }, async () => { while (next < jobs.length) await job(jobs[next++]); }));
}
