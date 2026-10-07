// Large jobs (6-7 distinct parts across several modules) to see whether the team pays off where the
// small composite jobs of team-cases.mjs did not. Same fixture and checks style.
// Probes are written on several lines for reading; the shell needs them on one.
const oneLine = (code) => code.replace(/\n\s*/g, " ");
const result = (pass, detail) => ({ pass: Boolean(pass), detail });
const testsPassing = (sh) => {
	const run = sh("npm test 2>&1");
	const fail = Number(/ℹ fail (\d+)/.exec(run.out)?.[1] ?? -1);
	const pass = Number(/ℹ pass (\d+)/.exec(run.out)?.[1] ?? -1);
	return { fail, pass, ok: fail === 0 && pass > 0 };
};

export const cases = [
	{
		id: "tl01", category: "large",
		turns: [
			"Costruisci il flusso ordini della libreria, in sette parti:\n" +
				"1. Correggi totalValue (deve moltiplicare per la quantità) e formatPrice per i negativi (-150 → \"€ -1,50\").\n" +
				"2. src/cart.js: createCart() → { lines: [] }; addToCart(cart, sku, qty) somma le quantità per lo stesso sku e lancia errore se qty <= 0.\n" +
				"3. src/discounts.js: applyCode(totalCents, code). \"SCONTO10\" toglie il 10% (arrotondato all'intero), \"MENO5\" toglie 500 centesimi ma solo se il totale è almeno 2000 (altrimenti errore), un codice sconosciuto lancia errore. Il risultato non va mai sotto 0.\n" +
				"4. src/orders.js: placeOrder(inventory, cart, code?) → { lines: [{ sku, title, qty, unitCents, lineCents }], subtotalCents, discountCents, totalCents }. Errore se uno sku non esiste o se la quantità supera lo stock; se l'ordine va a buon fine scala lo stock nell'inventario.\n" +
				"5. src/invoice.js: renderInvoice(order) → testo markdown con una riga per articolo e i totali formattati con formatPrice, inclusa una riga \"Totale: € X,YY\".\n" +
				"6. scripts/order.js: legge un file JSON { items: [{ sku, qty }], code? } passato come argomento, carica data/books.csv in un inventario (il CSV ha campi tra virgolette con virgole: vanno letti correttamente) e stampa la fattura.\n" +
				"7. Test per ogni modulo nuovo. Alla fine npm test deve passare.",
		],
		check: ({ js, sh }) => {
			const probe = js(oneLine(`Promise.all(["inventory","format","cart","discounts","orders","invoice"].map((m) => import("./src/" + m + ".js"))).then(([inv, fmt, cart, disc, ord, invo]) => {
				const t = (f) => { try { return f(); } catch { return "err"; } };
				const i = inv.createInventory();
				inv.addItem(i, { sku: "a", title: "A", priceCents: 1200, quantity: 5 });
				inv.addItem(i, { sku: "b", title: "B", priceCents: 800, quantity: 1 });
				const c = cart.createCart(); cart.addToCart(c, "a", 1); cart.addToCart(c, "a", 1); cart.addToCart(c, "b", 1);
				const order = ord.placeOrder(i, c, "SCONTO10");
				const over = cart.createCart(); cart.addToCart(over, "b", 2);
				const ghost = cart.createCart(); cart.addToCart(ghost, "zz", 1);
				const v = inv.createInventory(); inv.addItem(v, { sku: "x", priceCents: 100, quantity: 3 });
				console.log(JSON.stringify([
					inv.totalValue(v), fmt.formatPrice(-150), t(() => cart.addToCart(cart.createCart(), "a", 0)),
					disc.applyCode(10000, "SCONTO10"), t(() => disc.applyCode(1999, "MENO5")), disc.applyCode(3000, "MENO5"), t(() => disc.applyCode(100, "XX")),
					order.subtotalCents, order.discountCents, order.totalCents, i.items.map((it) => it.quantity).join("/"),
					t(() => ord.placeOrder(i, over)), t(() => ord.placeOrder(i, ghost)),
					/Totale:\\s*€ 28,80/.test(invo.renderInvoice(order)),
				]));
			})`));
			sh(`echo '{"items":[{"sku":"BK0057","qty":1}]}' > /tmp/pi-eval-order.json`);
			const script = sh("node scripts/order.js /tmp/pi-eval-order.json 2>&1").out;
			const tests = testsPassing(sh);
			const testFiles = sh("ls test").out;
			const covered = ["cart", "discount", "order", "invoice"].filter((name) => testFiles.includes(name)).length;
			const expected = '[300,"€ -1,50","err",9000,"err",2500,"err",3200,320,2880,"3/0","err","err",true]';
			return result(probe === expected && /Uomini, boschi e api/.test(script) && /Totale/.test(script) && tests.ok && covered === 4,
				`probe=${probe} script=${/Uomini, boschi e api/.test(script)} test pass=${tests.pass} fail=${tests.fail} moduli testati=${covered}/4`);
		},
	},
	{
		id: "tl02", category: "large",
		turns: [
			"Lavoro sul catalogo, in sette parti:\n" +
				"1. src/csv.js: parseCsv deve gestire i campi tra virgolette con virgole e restituire priceCents e quantity come numeri.\n" +
				"2. slugify deve togliere gli accenti (\"Perché è così\" → \"perche-e-cosi\").\n" +
				"3. paginate: la pagina 1 deve restituire i primi elementi.\n" +
				"4. src/search.js: searchBooks(books, { text, genre, author, sortBy, page, size }) → { items, total, pages }. text cerca nel titolo ignorando maiuscole e accenti; sortBy \"price\" (crescente) o \"title\"; default page 1 e size 20; total è il numero di risultati prima della paginazione.\n" +
				"5. scripts/report.js che genera data/report.md con una tabella per genere (numero di libri e quantità totale) e i 3 codici di errore più frequenti di logs/app.log con il conteggio.\n" +
				"6. Correggi il refuso nella chiave della soglia in config/settings.json e crea scripts/lowstock.js che stampa, uno per riga e in ordine, gli sku con quantità sotto la soglia.\n" +
				"7. Rinomina findByTag in findItemsByTag in tutto il progetto e rimuovi il codice morto da src/inventory.js.\n" +
				"Test per ogni modulo toccato. Alla fine npm test deve passare.",
		],
		check: ({ js, sh }) => {
			const probe = js(oneLine(`Promise.all(["csv","format","pagination","search"].map((m) => import("./src/" + m + ".js"))).then(async ([csv, fmt, pag, search]) => {
				const books = await csv.loadCatalog("data/books.csv");
				const gialli = search.searchBooks(books, { genre: "giallo" });
				const byPrice = search.searchBooks(books, { sortBy: "price", size: 200 }).items.map((b) => b.priceCents);
				const sorted = byPrice.every((p, k) => k === 0 || byPrice[k - 1] <= p);
				console.log(JSON.stringify([
					books.find((b) => b.sku === "BK0057")?.title, typeof books[0].priceCents, fmt.slugify("Perché è così"), pag.paginate([1,2,3,4,5], 1, 2),
					gialli.total, gialli.pages, gialli.items.length, sorted, search.searchBooks(books, { text: "UOMINI" }).items.map((b) => b.sku),
				]));
			})`));
			const report = sh("node scripts/report.js >/dev/null 2>&1; cat data/report.md").out;
			const reportOk = /giallo[^\n]*33[^\n]*220/i.test(report) && /E303[^\n]*58/.test(report);
			const expectedLow = sh(`python3 -c "import csv; print('\\n'.join(sorted(r['sku'] for r in csv.DictReader(open('data/books.csv')) if int(r['quantity']) < 3)))"`).out.trim();
			const low = sh("node scripts/lowstock.js 2>/dev/null").out.trim();
			const settings = sh("cat config/settings.json").out;
			const leftovers = sh("grep -rn findByTag src test").out.trim();
			const inventory = sh("cat src/inventory.js").out;
			const tests = testsPassing(sh);
			const expected = '["Uomini, boschi e api","number","perche-e-cosi",[1,2],33,2,20,true,["BK0057"]]';
			return result(probe === expected && reportOk && low === expectedLow && settings.includes("lowStockThreshold") && leftovers === "" && !inventory.includes("legacyExport") && tests.ok,
				`probe=${probe} report=${reportOk} lowstock=${low === expectedLow} residui="${leftovers}" test pass=${tests.pass} fail=${tests.fail}`);
		},
	},
];
