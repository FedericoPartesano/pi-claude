// Promemoria dell'intent dopo una compattazione reale. Scenario "aperto": intent in-progress -> il modello lo deve vedere.
// Scenario "chiuso": dopo la compattazione, prima del turno successivo, l'intent passa a done -> il modello non deve vederlo (lettura fresca).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
const scenario = process.argv[2] ?? "aperto";
const prompts = ["Spiega come marked trasforma una stringa markdown in HTML: quali sono le fasi e quali classi sono coinvolte.", "Come funziona il Lexer? Spiega la differenza tra lex e lexInline e cosa sono i token.", "Spiega come il Tokenizer riconosce un blocco di codice delimitato da tre backtick (fences). Indica file e metodo.", "Come si gestiscono gli elenchi (list) nel Tokenizer? Spiega in che modo riconosce gli elementi e i task.", "Qual è il ruolo di src/rules.ts? Perché le regex sono composte con un helper?", "Spiega la classe _Hooks e a cosa servono preprocess e postprocess.", "Come funziona il sistema di estensioni di marked (use, extensions, renderer personalizzati)? Spiega come si registra un renderer.", "Spiega la differenza tra la modalità gfm e commonmark nelle regole, e dove si vede nel codice.", "Come funziona walkTokens? Quando viene chiamato e a cosa serve?", "Come gestisce marked l'escape dell'HTML? Spiega dove avviene e quali funzioni usa."];
const dir = join(tmpdir(), "pi-intent", scenario);
checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), "7e8754d60b3c37be30aa17106ada623d1f0cf9db", dir);
mkdirSync(join(dir, "intents"), { recursive: true });
const file = join(dir, "intents", "2026-10-13-zebra.md");
const body = (status, tick) => `---\nstatus: ${status}\ncreated: 2026-10-13\nsource: user\n---\n# ZEBRA-4242 intent di prova\n\n## Outcome atteso\n- [${tick}] 1. Il codice marker è QUOKKA-77.\n\n## Vincoli\n- Non toccare mai il file CAPYBARA.txt.\n`;
writeFileSync(file, body("in-progress", " "));
const agent = new PiHarness(dir, "sonnet", undefined, { persistSession: true, environment: { PI_CAVEMAN_COMPACT: "1" } });
for (const p of prompts) await agent.runTurn(p);
const result = await new Promise((resolve) => {
	const id = "c1";
	const timer = setTimeout(() => resolve({ error: "timeout" }), 300000);
	const l = (r) => { if (r.type === "response" && r.id === id) { clearTimeout(timer); agent.process.listeners.delete(l); resolve(r); } };
	agent.process.listeners.add(l);
	agent.process.send({ id, type: "compact" });
});
console.log("compattazione:", result.success, result.error ?? "");
if (scenario === "chiuso") writeFileSync(file, body("done", "x"));
const t = await agent.runTurn("Senza usare tool e senza leggere file: nel contesto hai un promemoria 'Intent in corso' arrivato dopo la compattazione? Se sì riporta alla lettera il titolo e il codice marker dell'outcome; se no scrivi SOLO: ASSENTE.");
agent.close();
console.log(scenario, "->", t.answer.trim());
