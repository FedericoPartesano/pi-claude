// Vague feature requests with hidden requirements, to compare Pi direct (arm A) with Pi + intent interview (arm B).
//
// Fairness: arm A receives only `vague`, like a real user who does not spell everything out; there is no simulated
// user in arm A because nobody is asked anything. Arm B can discover `hidden` only by asking the simulated user,
// who answers only what is asked. Some hidden requirements name the API (module/function): arm A can match them only
// by guessing. That is part of what is measured (the cost of not asking), so the analysis also reports the
// requirements met excluding the API one (`metNoApi`), to separate "guessed a different name" from "built the wrong
// behaviour". Behaviour checks fall back gracefully when the module is missing (requirement not met, no crash).
const outcome = (results) => {
	const met = results.filter((r) => r.ok).length;
	const metNoApi = results.filter((r) => r.ok && !r.api).length;
	return {
		pass: met === results.length,
		met,
		total: results.length,
		metNoApi,
		totalNoApi: results.filter((r) => !r.api).length,
		detail: results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name}`).join(" · "),
	};
};
// Runs `body` (ES module code, `m` is the imported module) and returns its console.log output, or "ERR:<message>".
const probe = (js, modulePath, body) =>
	js(`import(${JSON.stringify(modulePath)}).then(async (m) => { try { ${body} } catch (e) { console.log("ERR:" + (e?.constructor?.name ?? "") + ":" + e?.message); } }).catch((e) => console.log("NOMODULE:" + e.message))`);
const throwsAs = (js, modulePath, call) => probe(js, modulePath, `${call}; console.log("NOTHROW");`);

export const cases = [
	{
		id: "ic01",
		vague: "Vorrei poter applicare gli sconti nel carrello.",
		hidden: [
			"Serve un nuovo file src/cart.js con la funzione cartTotal(lines, inventory, code): lines è un elenco di { sku, qty }, inventory è quello di src/inventory.js, code è il codice sconto (facoltativo). Restituisce il totale in centesimi interi.",
			"Codici validi: LIBRI10 = 10% di sconto sul totale; SPED5 = 500 centesimi di sconto fisso.",
			"Se nel carrello c'è uno sku che non esiste nell'inventario deve dare errore.",
			"Un codice sconosciuto deve dare errore (eccezione), non essere ignorato.",
			"Il totale non può mai andare sotto zero; gli arrotondamenti al centesimo sono all'intero più vicino.",
		],
		check: ({ js }) => {
			const setup = `const inv = await import("./src/inventory.js"); const i = inv.createInventory(); inv.addItem(i, { sku: "a", priceCents: 1999 }); inv.addItem(i, { sku: "b", priceCents: 300 });`;
			const api = probe(js, "./src/cart.js", `${setup} console.log(typeof m.cartTotal === "function" ? m.cartTotal([{ sku: "a", qty: 2 }], i) : "NOFN");`);
			const pct = probe(js, "./src/cart.js", `${setup} console.log(m.cartTotal([{ sku: "a", qty: 1 }, { sku: "b", qty: 1 }], i, "LIBRI10"));`);
			const fixed = probe(js, "./src/cart.js", `${setup} console.log(m.cartTotal([{ sku: "a", qty: 1 }], i, "SPED5"));`);
			const unknown = throwsAs(js, "./src/cart.js", `${setup} m.cartTotal([{ sku: "a", qty: 1 }], i, "BOH")`);
			const floor = probe(js, "./src/cart.js", `${setup} console.log(m.cartTotal([{ sku: "b", qty: 1 }], i, "SPED5"));`);
			const round = probe(js, "./src/cart.js", `const inv = await import("./src/inventory.js"); const i = inv.createInventory(); inv.addItem(i, { sku: "c", priceCents: 1005 }); console.log(m.cartTotal([{ sku: "c", qty: 1 }], i, "LIBRI10"));`);
			const missing = throwsAs(js, "./src/cart.js", `${setup} m.cartTotal([{ sku: "zzz", qty: 1 }], i)`);
			return outcome([
				{ name: "API cartTotal in src/cart.js", ok: api === "3998", api: true },
				{ name: "LIBRI10 = 10%", ok: pct === "2069" },
				{ name: "SPED5 = -500", ok: fixed === "1499" },
				{ name: "sku inesistente → errore", ok: missing.startsWith("ERR:") },
				{ name: "codice sconosciuto → errore", ok: unknown.startsWith("ERR:") },
				{ name: "mai sotto zero + arrotondamento", ok: floor === "0" && round === "905" },
			]);
		},
	},
	{
		id: "ic02",
		vague: "Aggiungiamo la ricerca nel catalogo.",
		hidden: [
			"Nuovo file src/search.js con la funzione searchCatalog(rows, query), dove rows sono le righe del catalogo (come le restituisce loadCatalog di src/csv.js). Restituisce le righe trovate.",
			"Si cerca sia nel titolo sia nell'autore, senza distinguere maiuscole e minuscole e ignorando gli accenti (\"perche\" trova \"Perché\").",
			"Se la ricerca è vuota o fatta solo di spazi non si restituisce niente (lista vuota), non tutto il catalogo.",
			"I risultati sono ordinati per titolo in ordine alfabetico.",
			"Al massimo 20 risultati.",
		],
		check: ({ js }) => {
			const rows = `const rows = [{ sku: "1", title: "Zeta", author: "Calvino" }, { sku: "2", title: "Perché no", author: "Levi" }, { sku: "3", title: "Alba", author: "Morante" }, { sku: "4", title: "Bosco", author: "Calvino" }, ...Array.from({ length: 30 }, (_, n) => ({ sku: "x" + n, title: "Serie " + String(n).padStart(2, "0"), author: "Eco" }))];`;
			const call = (query) => probe(js, "./src/search.js", `${rows} const r = m.searchCatalog(rows, ${JSON.stringify(query)}); console.log(JSON.stringify(r.map((x) => x.sku)));`);
			const api = probe(js, "./src/search.js", `console.log(typeof m.searchCatalog);`);
			const author = call("calvino");
			const accent = call("PERCHE");
			const empty = call("   ");
			const many = call("eco");
			return outcome([
				{ name: "API searchCatalog in src/search.js", ok: api === "function", api: true },
				{ name: "titolo e autore, case-insensitive", ok: JSON.parse(author.startsWith("[") ? author : "[]").length === 2 },
				{ name: "ignora accenti", ok: accent === '["2"]' },
				{ name: "ricerca vuota → []", ok: empty === "[]" },
				{ name: "ordine alfabetico per titolo", ok: author === '["4","1"]' },
				{ name: "max 20 risultati", ok: many.startsWith("[") && JSON.parse(many).length === 20 },
			]);
		},
	},
	{
		id: "ic03",
		vague: "Serve un export del report di magazzino.",
		hidden: [
			"Nuovo file src/report.js con la funzione exportStockReport(inventory) che restituisce il testo del file CSV (una stringa), usando l'inventario di src/inventory.js.",
			"Separatore punto e virgola, perché lo apriamo con Excel italiano. Intestazione esatta: sku;title;quantity;valueCents.",
			"valueCents è il valore della riga: prezzo in centesimi per quantità.",
			"Righe ordinate per valore decrescente.",
			"In fondo una riga di totale: TOTALE;;;<somma dei valori>.",
		],
		check: ({ js }) => {
			const setup = `const inv = await import("./src/inventory.js"); const i = inv.createInventory(); inv.addItem(i, { sku: "a", title: "Uno", priceCents: 100, quantity: 2 }); inv.addItem(i, { sku: "b", title: "Due", priceCents: 1000, quantity: 1 }); inv.addItem(i, { sku: "c", title: "Tre", priceCents: 50, quantity: 1 });`;
			const out = probe(js, "./src/report.js", `${setup} console.log(JSON.stringify(m.exportStockReport(i)));`);
			let lines = [];
			try {
				lines = JSON.parse(out).trim().split(/\r?\n/);
			} catch {}
			return outcome([
				{ name: "API exportStockReport in src/report.js", ok: lines.length > 0, api: true },
				{ name: "separatore ; e intestazione", ok: lines[0] === "sku;title;quantity;valueCents" },
				{ name: "valueCents = prezzo × quantità", ok: lines.includes("a;Uno;2;200") },
				{ name: "ordine per valore decrescente", ok: lines[1]?.startsWith("b;") && lines[2]?.startsWith("a;") && lines[3]?.startsWith("c;") },
				{ name: "riga TOTALE;;;1250", ok: lines.at(-1) === "TOTALE;;;1250" },
			]);
		},
	},
	{
		id: "ic04",
		vague: "Lo sconto sugli articoli a volte dà risultati strani, sistemiamolo.",
		hidden: [
			"Si tratta di applyDiscount(item, percent) in src/inventory.js: il nome e la firma restano gli stessi.",
			"Lo sconto massimo è 90%: percentuali sotto 0 o sopra 90 devono dare un errore di tipo RangeError.",
			"Se percent non è un numero deve dare un errore TypeError.",
			"Sono ammesse percentuali con decimali (es. 12,5%); il prezzo finale si arrotonda per eccesso, a favore del negozio.",
			"Gli articoli con il tag \"no-sconto\" non vanno scontati: si restituiscono invariati.",
		],
		check: ({ js }) => {
			const mod = "./src/inventory.js";
			const range = throwsAs(js, mod, `m.applyDiscount({ sku: "a", priceCents: 1000, tags: [] }, 95)`);
			const negative = throwsAs(js, mod, `m.applyDiscount({ sku: "a", priceCents: 1000, tags: [] }, -1)`);
			const type = throwsAs(js, mod, `m.applyDiscount({ sku: "a", priceCents: 1000, tags: [] }, "10")`);
			const ceil = probe(js, mod, `console.log(m.applyDiscount({ sku: "a", priceCents: 999, tags: [] }, 12.5).priceCents);`);
			const tag = probe(js, mod, `console.log(m.applyDiscount({ sku: "a", priceCents: 1000, tags: ["no-sconto"] }, 50).priceCents);`);
			const ok90 = probe(js, mod, `console.log(m.applyDiscount({ sku: "a", priceCents: 1000, tags: [] }, 90).priceCents);`);
			return outcome([
				{ name: "API applyDiscount invariata (90% ok)", ok: ok90 === "100", api: true },
				{ name: "RangeError fuori 0..90", ok: range.startsWith("ERR:RangeError") && negative.startsWith("ERR:RangeError") },
				{ name: "TypeError se non numero", ok: type.startsWith("ERR:TypeError") },
				{ name: "decimali + arrotondamento per eccesso", ok: ceil === "875" },
				{ name: "tag no-sconto invariato", ok: tag === "1000" },
			]);
		},
	},
	{
		id: "ic05",
		vague: "La paginazione va migliorata.",
		hidden: [
			"paginate(items, page, size) in src/pagination.js: le pagine partono da 1 (la pagina 1 sono i primi elementi).",
			"Pagina oltre l'ultima → lista vuota; pagina minore di 1 → errore RangeError.",
			"Se size non viene passato vale 20.",
			"Nuova funzione paginateWithMeta(items, page, size) nello stesso file che restituisce { items, page, totalPages, hasNext }.",
			"pageCount di una lista vuota vale 1 (una pagina vuota).",
		],
		check: ({ js }) => {
			const mod = "./src/pagination.js";
			const list = "Array.from({ length: 45 }, (_, n) => n)";
			const first = probe(js, mod, `console.log(JSON.stringify(m.paginate(${list}, 1, 3)));`);
			const beyond = probe(js, mod, `console.log(JSON.stringify(m.paginate(${list}, 99, 10)));`);
			const zero = throwsAs(js, mod, `m.paginate(${list}, 0, 10)`);
			const def = probe(js, mod, `console.log(m.paginate(${list}, 2).length);`);
			const meta = probe(js, mod, `const r = m.paginateWithMeta(${list}, 3, 20); console.log(JSON.stringify([r.items.length, r.page, r.totalPages, r.hasNext]));`);
			const empty = probe(js, mod, `console.log(m.pageCount([], 10));`);
			return outcome([
				{ name: "pagine da 1", ok: first === "[0,1,2]" },
				{ name: "oltre l'ultima [] e <1 RangeError", ok: beyond === "[]" && zero.startsWith("ERR:RangeError") },
				{ name: "size predefinito 20", ok: def === "20" },
				{ name: "API paginateWithMeta", ok: meta === "[5,3,3,false]", api: true },
				{ name: "pageCount([]) = 1", ok: empty === "1" },
			]);
		},
	},
	{
		id: "ic06",
		vague: "Vorrei che i prezzi si leggessero meglio.",
		hidden: [
			"Si tratta di formatPrice(cents) in src/format.js, che resta con lo stesso nome; aggiungere un secondo parametro facoltativo currency.",
			"Separatore delle migliaia col punto: 123456 → \"€ 1.234,56\".",
			"Negativi col meno davanti al simbolo: -150 → \"-€ 1,50\".",
			"currency \"USD\" usa il simbolo $ (\"$ 12,34\"); senza currency resta l'euro.",
			"Se cents non è un numero intero deve dare un errore TypeError.",
		],
		check: ({ js }) => {
			const mod = "./src/format.js";
			const thousands = probe(js, mod, `console.log(m.formatPrice(123456));`);
			const negative = probe(js, mod, `console.log(m.formatPrice(-150));`);
			const usd = probe(js, mod, `console.log(m.formatPrice(1234, "USD"));`);
			const keep = probe(js, mod, `console.log(m.formatPrice(1234));`);
			const notInt = throwsAs(js, mod, `m.formatPrice(12.5)`);
			return outcome([
				{ name: "API formatPrice(cents, currency)", ok: keep === "€ 12,34" && usd.includes("12,34"), api: true },
				{ name: "migliaia col punto", ok: thousands === "€ 1.234,56" },
				{ name: "negativi -€", ok: negative === "-€ 1,50" },
				{ name: "USD con $", ok: usd === "$ 12,34" },
				{ name: "TypeError se non intero", ok: notInt.startsWith("ERR:TypeError") },
			]);
		},
	},
];
