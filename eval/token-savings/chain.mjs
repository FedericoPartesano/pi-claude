// Long chain on marked: big outputs early, recall questions late. A/B: base Pi vs Pi + context-tiers (low limit so it triggers).
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const mode = arg("mode", "base"); const attempt = arg("attempt", "1");
const ext = new URL("../../extensions/context-tiers.ts", import.meta.url).pathname;
const steps = [
	["Leggi per intero src/Tokenizer.ts con il tool read (senza scorciatoie, devo vedere tutto il contenuto) e dimmi quanti metodi ha la classe _Tokenizer escluso il costruttore. Solo il numero.", (a) => /\b24\b/.test(a)],
	["Leggi per intero src/rules.ts con il tool read (senza scorciatoie, devo vedere tutto il contenuto) e dimmi a che riga di src/rules.ts è definita la costante bullet. Solo il numero.", (a) => /\b117\b/.test(a)],
	["Leggi per intero src/Lexer.ts con il tool read (senza scorciatoie, devo vedere tutto il contenuto) e dimmi quante righe ha. Solo il numero.", (a) => /\b567\b/.test(a)],
	["Leggi per intero src/Parser.ts con il tool read (senza scorciatoie, devo vedere tutto il contenuto) e dimmi quante righe ha. Solo il numero.", (a) => /\b205\b/.test(a)],
	["Leggi per intero src/Renderer.ts con il tool read (senza scorciatoie, devo vedere tutto il contenuto) e dimmi quante righe ha. Solo il numero.", (a) => /\b203\b/.test(a)],
	["Quanti metodi aveva _Tokenizer, come hai contato all'inizio? Solo il numero.", (a) => /\b24\b/.test(a)],
	["A che riga di src/rules.ts avevi trovato bullet? Solo il numero.", (a) => /\b117\b/.test(a)],
	["Quante righe ha src/Lexer.ts? Solo il numero.", (a) => /\b567\b/.test(a)],
];
const dir = join(tmpdir(), "pi-tiers", `${mode}-${attempt}`);
checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), "7e8754d60b3c37be30aa17106ada623d1f0cf9db", dir);
const env = mode === "tiers" ? { PI_TIERS_LIMIT: "12000", PI_TIERS_KEEP: "2", PI_TIERS_LOG: "/tmp/tiers.log" } : {};
const agent = new PiHarness(dir, "sonnet", undefined, { extraArgs: mode === "tiers" ? ["-e", ext] : [], environment: env });
const t0 = Date.now(); const sum = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }; let pass = 0; const rows = [];
for (const [prompt, check] of steps) {
	const turn = await agent.runTurn(prompt);
	for (const k of Object.keys(sum)) sum[k] += turn.usage[k] ?? 0;
	const ok = check(turn.answer); pass += ok; rows.push({ ok, answer: turn.answer.slice(0, 40), requests: turn.requests, tools: turn.tools.length });
}
agent.close();
const cost = sum.cacheRead * 0.1 + sum.cacheWrite * 1.25 + sum.input + sum.output * 5;
const rec = { mode, attempt, pass, of: steps.length, seconds: Math.round((Date.now() - t0) / 1000), cost, ...sum, rows };
mkdirSync(join(import.meta.dirname, "results"), { recursive: true });
appendFileSync(join(import.meta.dirname, "results", "chain.jsonl"), JSON.stringify(rec) + "\n");
console.log(JSON.stringify({ ...rec, rows: undefined }));
