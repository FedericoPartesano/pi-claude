import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
import { MARKED_BASE } from "../lean/e4-cases.mjs";
const heavy = [
	{ id: "h1", prompt: "Leggi package-lock.json con cat e dimmi quante chiavi sotto \"packages\" ha e qual è la prima chiave in ordine alfabetico diversa da \"\".", check: (a) => /\d{2,}/.test(a) },
	{ id: "h2", prompt: "Esegui `git log -p -5` e dimmi in una frase per ciascuno dei 5 commit cosa è cambiato.", check: (a) => a.length > 200 },
	{ id: "h3", prompt: "Mostra con cat tutto src/rules.ts e dimmi quante dichiarazioni `export const` ci sono nel file.", check: (a) => /\d+/.test(a) },
	{ id: "h4", prompt: "Leggi interamente src/Tokenizer.ts e src/Lexer.ts con cat e spiega come il Lexer usa il Tokenizer per i blocchi di codice.", check: (a) => /Tokenizer/.test(a) && /Lexer/.test(a) },
	{ id: "h5", prompt: "Esegui `git log --stat -40` e dimmi quale file compare in più commit e in quanti.", check: (a) => /\d+/.test(a) },
	{ id: "h6", prompt: "Esegui `rg -n . src | head -1500` e dimmi quale file ha più righe non vuote tra quelle mostrate.", check: (a) => /src\//.test(a) },
];
const repeat = Number(process.argv[2] ?? 1);
const ext = "/tmp/cav-cli/pkg/package/dist/caveman-pi-extension.mjs";
const env = { CAVEMAN_HOME: "/tmp/cav-home/.caveman", CAVE_GATEWAY_URL: "http://127.0.0.1:8791", CAVEMAN_PI_HOOK_CMD: JSON.stringify(["node","/tmp/cav-cli/pkg/package/dist/index.js"]), CAVEMAN_MCP_BIN: "/tmp/cav-home/.caveman/bin/caveman-mcp", ANTHROPIC_BASE_URL: "http://127.0.0.1:8791" };
const jobs = heavy.flatMap((c) => ["base", "native"].flatMap((mode) => Array.from({ length: repeat }, (_, i) => ({ c, mode, i }))));
const out = join(import.meta.dirname, "results"); mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: 3 }, async () => {
	while (jobs.length) {
		const { c, mode, i } = jobs.shift();
		const dir = join(tmpdir(), "pi-nat", `${c.id}-${mode}-${i}`);
		checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), MARKED_BASE, dir);
		const agent = new PiHarness(dir, "sonnet", undefined, { extraArgs: mode === "native" ? ["-e", ext] : [], environment: mode === "native" ? env : {} });
		const t = await agent.runTurn(c.prompt); agent.close();
		const u = t.usage; const cost = u.cacheRead * 0.1 + u.cacheWrite * 1.25 + u.input + u.output * 5;
		const rec = { case: c.id, mode, i, pass: c.check(t.answer), seconds: t.seconds, requests: t.requests, output: u.output, input: u.input + u.cacheRead + u.cacheWrite, cost, answer: t.answer };
		appendFileSync(join(out, "native-ab.jsonl"), JSON.stringify(rec) + "\n");
		console.log(rec.pass ? "PASS" : "FAIL", c.id, mode, `cost=${Math.round(cost)}`);
	}
}));
