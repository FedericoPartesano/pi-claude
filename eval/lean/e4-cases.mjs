// E4: code-navigation questions on marked (big repo, pinned commit), answers checked against the code.
export const MARKED_BASE = "7e8754d60b3c37be30aa17106ada623d1f0cf9db";
const has = (text, ...patterns) => patterns.every((pattern) => pattern.test(text));
export const cases = [
	{ id: "n01", prompt: "In quale file e in quale metodo marked riconosce i blocchi di codice delimitati da tre backtick (fenced code)? Rispondi con file e nome del metodo, senza modificare nulla.", check: (a) => has(a, /Tokenizer\.ts/, /\bfences\b/) },
	{ id: "n02", prompt: "Quanti metodi ha la classe _Tokenizer in src/Tokenizer.ts, escluso il costruttore? Rispondi con il numero.", check: (a) => /\b24\b/.test(a) },
	{ id: "n03", prompt: "Quali hook sono nell'insieme passThroughHooks della classe _Hooks? Elencali.", check: (a) => has(a, /preprocess/, /postprocess/, /processAllTokens/, /emStrongMask/) },
	{ id: "n04", prompt: "In quale file e con quale nome di costante è definita la regex dei punti elenco (bullet) delle liste?", check: (a) => has(a, /rules\.ts/, /\bbullet\b/) },
	{ id: "n05", prompt: "Quale funzione in src/helpers.ts fa l'escape delle entità HTML? Dammi il nome esatto.", check: (a) => /escapeHtmlEntities/.test(a) },
	{ id: "n06", prompt: "Quanti file *.test.js ci sono in test/unit? Rispondi con il numero.", check: (a) => /\b6\b/.test(a) },
	{ id: "n07", prompt: "Quale metodo della classe _Tokenizer gestisce le definizioni dei link di riferimento ([foo]: url)? Dimmi nome del metodo e riga in cui inizia.", check: (a) => has(a, /\bdef\b/, /\b583\b/) },
	{ id: "n08", prompt: "Come si chiama il metodo della classe _Renderer che produce il testo barrato (strikethrough)?", check: (a) => /\bdel\b/.test(a) },
	{ id: "n09", prompt: "In src/defaults.ts qual è il valore predefinito dell'opzione gfm e a che riga si trova?", check: (a) => has(a, /\btrue\b/, /\b11\b/) },
	{ id: "n10", prompt: "Qual è la versione di marked dichiarata in package.json?", check: (a) => /18\.1\.0/.test(a) },
];
