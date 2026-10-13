// Catena lunga (30 passi) su marked: base vs context-tiers con impostazioni normali.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const mode = arg("mode", "base"); const attempt = arg("attempt", "1");
const ext = new URL("../../extensions/context-tiers.ts", import.meta.url).pathname;
const files = { "Tokenizer.ts": 1084, "rules.ts": 614, "Lexer.ts": 567, "Instance.ts": 404, "Tokens.ts": 226, "Parser.ts": 205, "helpers.ts": 204, "Renderer.ts": 203, "marked.ts": 166, "MarkedOptions.ts": 155, "Hooks.ts": 69, "TextRenderer.ts": 48 };
const ok = (n) => (a) => new RegExp(`\\b${n}\\b|\\b${String(n).replace(/\B(?=(\d{3})+$)/g, ".")}\\b`).test(a) || new RegExp(`\\b${n + 1}\\b`).test(a);
const steps = [];
const names = Object.keys(files);
for (const f of names) steps.push([`Leggi per intero src/${f} con il tool read (senza scorciatoie) e dimmi quante righe ha. Solo il numero.`, ok(files[f])]);
const order = [3, 0, 7, 10, 5, 1, 9, 2, 11, 4, 8, 6];
for (const i of order.slice(0, 12)) steps.push([`Quante righe ha src/${names[i]}? Solo il numero.`, ok(files[names[i]])]);
steps.push(["Quale tra i file letti ha più righe e quale meno? Solo i due nomi.", (a) => /Tokenizer/.test(a) && /defaults|TextRenderer/.test(a)]);
steps.push(["Quanti file hai letto in questa conversazione? Solo il numero.", (a) => /\b(12|13)\b/.test(a)]);
steps.push(["Rileggi src/Hooks.ts e dimmi quanti metodi ha la classe _Hooks. Solo il numero.", (a) => /\b[5-8]\b/.test(a)]);
steps.push(["Qual è la somma delle righe di Lexer.ts e Parser.ts? Solo il numero.", (a) => /\b(772|773|774)\b/.test(a)]);
steps.push(["Quante righe ha src/Tokenizer.ts? Solo il numero.", ok(1084)]);
steps.push(["Quante righe ha src/rules.ts? Solo il numero.", ok(614)]);
const dir = join(tmpdir(), "pi-long", `${mode}-${attempt}`);
checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), "7e8754d60b3c37be30aa17106ada623d1f0cf9db", dir);
const env = mode === "tiers" ? {} : {};
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
appendFileSync(join(import.meta.dirname, "results", "chain-long.jsonl"), JSON.stringify(rec) + "\n");
console.log(JSON.stringify({ ...rec, rows: undefined }));
