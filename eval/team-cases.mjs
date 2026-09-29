// Composite jobs (several distinct parts) to compare Pi alone with Pi + team.
// Same fixture and checks style as cases.mjs.
const result = (pass, detail) => ({ pass: Boolean(pass), detail });
const testsPassing = (sh) => {
	const run = sh("npm test 2>&1");
	const fail = Number(/ℹ fail (\d+)/.exec(run.out)?.[1] ?? -1);
	const pass = Number(/ℹ pass (\d+)/.exec(run.out)?.[1] ?? -1);
	return { fail, pass, ok: fail === 0 && pass > 0 };
};

export const cases = [
	{
		id: "tc01", category: "composite",
		turns: ["Correggi tutti questi bug e aggiungi un test per ognuno: (1) totalValue ignora la quantità; (2) formatPrice(-150) deve dare \"€ -1,50\"; (3) parseCsv non gestisce i campi tra virgolette con virgole (vedi BK0057 in data/books.csv); (4) slugify(\"Perché è così\") deve dare \"perche-e-cosi\"; (5) paginate: la pagina 1 deve restituire i primi elementi. Alla fine npm test deve passare."],
		check: ({ js, sh }) => {
			const values = js('Promise.all([import("./src/inventory.js"), import("./src/format.js"), import("./src/csv.js"), import("./src/pagination.js")]).then(async ([inv, fmt, csv, pag]) => { const i = inv.createInventory(); inv.addItem(i, { sku: "a", priceCents: 100, quantity: 3 }); const rows = await csv.loadCatalog("data/books.csv"); console.log(JSON.stringify([inv.totalValue(i), fmt.formatPrice(-150), rows.find((r) => r.sku === "BK0057")?.title, fmt.slugify("Perché è così"), pag.paginate([1,2,3,4], 1, 2)])); })');
			const tests = testsPassing(sh);
			return result(values === '[300,"€ -1,50","Uomini, boschi e api","perche-e-cosi",[1,2]]' && tests.ok && tests.pass >= 10, `valori=${values} test pass=${tests.pass} fail=${tests.fail}`);
		},
	},
	{
		id: "tc02", category: "composite",
		turns: ["Crea un modulo src/cart.js con: createCart() → { lines: [] }; addToCart(cart, sku, qty) che somma le quantità per lo stesso sku e lancia errore se qty <= 0 o se la riga supera 10 pezzi; removeFromCart(cart, sku); cartTotalCents(cart, inventory) che usa i prezzi dell'inventario (src/inventory.js). Scrivi test/cart.test.js che copra tutto. npm test deve passare (a parte eventuali test già rotti prima, che non devi toccare)."],
		check: ({ js, sh }) => {
			const value = js('Promise.all([import("./src/cart.js"), import("./src/inventory.js")]).then(([m, inv]) => { const c = m.createCart(); const t = (f) => { try { f(); return "ok"; } catch { return "err"; } }; const i = inv.createInventory(); inv.addItem(i, { sku: "a", priceCents: 250 }); m.addToCart(c, "a", 2); m.addToCart(c, "a", 1); console.log([t(() => m.addToCart(c, "b", 0)), t(() => m.addToCart(c, "a", 8)), m.cartTotalCents(c, i), (m.removeFromCart(c, "a"), c.lines.length)].join()); })');
			const cartTests = sh("node --test test/cart.test.js 2>&1").out;
			return result(value === "err,err,750,0" && /ℹ fail 0/.test(cartTests) && /ℹ pass [3-9]|ℹ pass \d\d/.test(cartTests), `api=${value} cartTests=${/ℹ fail 0/.test(cartTests)}`);
		},
	},
	{
		id: "tc03", category: "composite",
		turns: ["Refactoring in tre parti: (1) sposta applyDiscount da src/inventory.js in un nuovo modulo src/pricing.js e fai in modo che lanci errore per percentuali fuori da 0-100; (2) rinomina findByTag in findItemsByTag in tutto il progetto; (3) rimuovi il codice morto da src/inventory.js. Aggiungi test per applyDiscount. I test esistenti devono continuare a passare (tranne quello di totalValue che è già rotto: non toccarlo)."],
		check: ({ js, sh }) => {
			const value = js('import("./src/pricing.js").then((m) => { const t = (p) => { try { return m.applyDiscount({ priceCents: 1000 }, p).priceCents; } catch { return "err"; } }; console.log([t(10), t(150), t(-1)].join()); })');
			const inventory = sh("cat src/inventory.js").out;
			const leftovers = sh("grep -rn findByTag src test").out.trim();
			const tests = testsPassing(sh);
			return result(value === "900,err,err" && !/function applyDiscount/.test(inventory) && !inventory.includes("legacyExport") && leftovers === "" && tests.fail <= 1 && tests.pass >= 6, `pricing=${value} residui="${leftovers}" pass=${tests.pass} fail=${tests.fail}`);
		},
	},
	{
		id: "tc04", category: "composite",
		turns: ["Crea uno script scripts/report.js che genera data/report.md con: (a) una tabella markdown per genere con numero di libri e quantità totale (leggendo correttamente data/books.csv, che ha campi tra virgolette); (b) i 3 codici di errore più frequenti di logs/app.log con il conteggio. Eseguilo e verifica che i numeri siano giusti."],
		check: ({ sh }) => {
			const report = sh("node scripts/report.js >/dev/null 2>&1; cat data/report.md").out;
			return result(/giallo[^\n]*33[^\n]*220/i.test(report) && /saggio[^\n]*32/i.test(report) && /E303[^\n]*58/.test(report) && /E202[^\n]*39/.test(report), `report ${report.length} caratteri`);
		},
	},
	{
		id: "tc05", category: "composite",
		turns: ["Correggi il refuso nella chiave di config/settings.json, poi crea src/config.js con una funzione loadConfig(path) che legge il JSON e valida: storeName stringa non vuota, pageSize intero tra 1 e 100, currency di 3 lettere maiuscole; se non valido lancia un errore che dice quale campo è sbagliato. Aggiungi test per casi validi e non validi."],
		check: ({ js, sh }) => {
			const config = sh("cat config/settings.json").out;
			const value = js('import("./src/config.js").then(async (m) => { const fs = await import("node:fs"); const t = (obj) => { fs.writeFileSync("/tmp/pi-eval-config-probe.json", JSON.stringify(obj)); try { m.loadConfig("/tmp/pi-eval-config-probe.json"); return "ok"; } catch (e) { return String(e.message).toLowerCase().includes("pagesize") ? "pagesize" : "err"; } }; const base = { storeName: "X", pageSize: 20, currency: "EUR" }; console.log([t(base), t({ ...base, pageSize: 0 }), t({ ...base, currency: "eu" }), t({ ...base, storeName: "" })].join()); })');
			const tests = sh("npm test 2>&1").out;
			const configTests = /config/i.test(sh("ls test").out);
			return result(config.includes("lowStockThreshold") && value === "ok,pagesize,err,err" && configTests, `loadConfig=${value} testConfig=${configTests}`);
		},
	},
	{
		id: "tc06", category: "composite",
		turns: ["Prepara la release 1.3.0: correggi il bug di totalValue e quello di paginate (la pagina 1 deve dare i primi elementi) con i relativi test, porta la versione a 1.3.0 in package.json, aggiungi al CHANGELOG una sezione 1.3.0 che elenchi le correzioni, e fai un commit con messaggio 'Release 1.3.0'. npm test deve passare."],
		check: ({ sh }) => {
			const version = JSON.parse(sh("cat package.json").out).version;
			const changelog = sh("git show HEAD:CHANGELOG.md").out;
			const message = sh("git log -1 --format=%s").out.trim();
			const dirty = sh("git status --porcelain").out.trim();
			const tests = testsPassing(sh);
			return result(version === "1.3.0" && /1\.3\.0/.test(changelog) && /Release 1\.3\.0/.test(message) && tests.ok && dirty === "", `version=${version} commit="${message}" test=${tests.ok} sporco="${dirty.slice(0, 40)}"`);
		},
	},
];
