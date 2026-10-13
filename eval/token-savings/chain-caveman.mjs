// Sessione lunga di spiegazioni su marked: Caveman spento (off), regole morbide (lite) o regole predefinite (full), stesso modello.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const mode = arg("mode", "off"); const attempt = arg("attempt", "1");
const k = (...r) => (a) => r.every((x) => x.test(a));
const steps = [
	["Spiega come marked trasforma una stringa markdown in HTML: quali sono le fasi e quali classi sono coinvolte.", k(/Lexer/, /Parser/, /Renderer/)],
	["Come funziona il Lexer? Spiega la differenza tra lex e lexInline e cosa sono i token.", k(/lexInline/, /token/i)],
	["Spiega come il Tokenizer riconosce un blocco di codice delimitato da tre backtick (fences). Indica file e metodo.", k(/fences/, /Tokenizer/)],
	["Come si gestiscono gli elenchi (list) nel Tokenizer? Spiega in che modo riconosce gli elementi e i task.", k(/list/i, /Tokenizer/)],
	["Qual è il ruolo di src/rules.ts? Perché le regex sono composte con un helper?", k(/rules\.ts/, /regex|espression/i)],
	["Spiega la classe _Hooks e a cosa servono preprocess e postprocess.", k(/preprocess/, /postprocess/)],
	["Come funziona il sistema di estensioni di marked (use, extensions, renderer personalizzati)? Spiega come si registra un renderer.", k(/use/, /renderer/i)],
	["Spiega la differenza tra la modalità gfm e commonmark nelle regole, e dove si vede nel codice.", k(/gfm/i, /commonmark/i)],
	["Come funziona walkTokens? Quando viene chiamato e a cosa serve?", k(/walkTokens/)],
	["Come gestisce marked l'escape dell'HTML? Spiega dove avviene e quali funzioni usa.", k(/escape/i)],
	["Spiega come funziona il Renderer per i link e le immagini, e come si costruisce l'HTML.", k(/link/i, /image|immagin/i)],
	["Cosa fa il TextRenderer e perché esiste accanto al Renderer?", k(/TextRenderer/)],
	["Spiega come le opzioni (MarkedOptions, defaults) vengono unite e passate alle classi.", k(/defaults|option|opzion/i)],
	["Come funziona la gestione delle tabelle? Spiega quale regola le riconosce e come diventano token.", k(/table|tabell/i)],
	["Riassumi in modo ordinato quanto spiegato finora: i componenti principali e come collaborano.", k(/Lexer/, /Parser/, /Tokenizer/)],
	["Delle cose spiegate prima, quale parte è più complessa da modificare e perché? Motiva con riferimenti al codice già visto.", (a) => a.length > 200],
];
const dir = join(tmpdir(), "pi-cvl", `${mode}-${attempt}`);
checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), "7e8754d60b3c37be30aa17106ada623d1f0cf9db", dir);
const agent = new PiHarness(dir, "sonnet", undefined, { environment: { PI_CAVEMAN: { off: "0", lite: "lite", full: "1" }[mode] } });
const t0 = Date.now(); const sum = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }; let pass = 0, chars = 0; const rows = [];
for (const [prompt, check] of steps) {
	const turn = await agent.runTurn(prompt);
	for (const key of Object.keys(sum)) sum[key] += turn.usage[key] ?? 0;
	const ok = check(turn.answer); pass += ok; chars += turn.answer.length; rows.push({ ok, chars: turn.answer.length, answer: turn.answer });
}
agent.close();
const cost = sum.cacheRead * 0.1 + sum.cacheWrite * 1.25 + sum.input + sum.output * 5;
const rec = { mode, attempt, pass, of: steps.length, seconds: Math.round((Date.now() - t0) / 1000), cost, chars, ...sum, rows };
mkdirSync(join(import.meta.dirname, "results"), { recursive: true });
appendFileSync(join(import.meta.dirname, "results", "chain-caveman.jsonl"), JSON.stringify(rec) + "\n");
console.log(JSON.stringify({ ...rec, rows: undefined }));
