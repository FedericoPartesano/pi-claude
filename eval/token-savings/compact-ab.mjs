// Compattazione reale: riassunto di Pi normale (PI_CAVEMAN_COMPACT=0) contro quello asciutto di Caveman. Stessa sessione, stesso modello.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const mode = arg("mode", "off"); const attempt = arg("attempt", "1");
const prompts = ["Spiega come marked trasforma una stringa markdown in HTML: quali sono le fasi e quali classi sono coinvolte.", "Come funziona il Lexer? Spiega la differenza tra lex e lexInline e cosa sono i token.", "Spiega come il Tokenizer riconosce un blocco di codice delimitato da tre backtick (fences). Indica file e metodo.", "Come si gestiscono gli elenchi (list) nel Tokenizer? Spiega in che modo riconosce gli elementi e i task.", "Qual è il ruolo di src/rules.ts? Perché le regex sono composte con un helper?", "Spiega la classe _Hooks e a cosa servono preprocess e postprocess.", "Come funziona il sistema di estensioni di marked (use, extensions, renderer personalizzati)? Spiega come si registra un renderer.", "Spiega la differenza tra la modalità gfm e commonmark nelle regole, e dove si vede nel codice.", "Come funziona walkTokens? Quando viene chiamato e a cosa serve?", "Come gestisce marked l'escape dell'HTML? Spiega dove avviene e quali funzioni usa."];
const dir = join(tmpdir(), "pi-cmp", `${mode}-${attempt}`);
checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), "7e8754d60b3c37be30aa17106ada623d1f0cf9db", dir);
const agent = new PiHarness(dir, "sonnet", undefined, { persistSession: true, environment: { PI_CAVEMAN_COMPACT: mode === "on" ? "1" : "0" } });
for (const p of prompts) await agent.runTurn(p);
const result = await new Promise((resolve) => {
	const id = "c1";
	const timer = setTimeout(() => resolve({ error: "timeout" }), 300000);
	const l = (r) => { if (r.type === "response" && r.id === id) { clearTimeout(timer); agent.process.listeners.delete(l); resolve(r); } };
	agent.process.listeners.add(l);
	agent.process.send({ id, type: "compact" });
});
agent.close();
const data = result.data ?? {};
const summary = data.summary ?? "";
const rec = { mode, attempt, success: result.success, error: result.error, chars: summary.length, tokensBefore: data.tokensBefore, usage: data.usage, summary };
mkdirSync(join(import.meta.dirname, "results"), { recursive: true });
appendFileSync(join(import.meta.dirname, "results", "compact-ab.jsonl"), JSON.stringify(rec) + "\n");
console.log(JSON.stringify({ ...rec, summary: undefined }));
