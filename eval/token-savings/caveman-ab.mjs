import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
import { cases, MARKED_BASE } from "../lean/e4-cases.mjs";
const has = (t, ...p) => p.every((x) => x.test(t));
const explain = [
	{ id: "s1", prompt: "Spiega come marked trasforma un blocco di codice delimitato da tre backtick in HTML: quali file e quali metodi sono coinvolti, in ordine.", check: (a) => has(a, /Tokenizer/, /\bfences\b/, /Renderer/, /\bcode\b/) },
	{ id: "s2", prompt: "Come funziona il meccanismo degli hook in marked (classe _Hooks)? Spiega a cosa servono preprocess e postprocess.", check: (a) => has(a, /preprocess/, /postprocess/) },
	{ id: "s3", prompt: "Perché in src/rules.ts le regex dei blocchi usano un helper per comporle invece di scriverle intere? Guarda il codice e spiega.", check: (a) => /edit|replace|compon|riusa|rius|compos/i.test(a) },
	{ id: "s4", prompt: "Quali sono le differenze tra le modalità gfm e commonmark nelle regole di marked? Indica dove nel codice si vede.", check: (a) => has(a, /gfm/i, /rules\.ts/) },
];
const all = [...cases, ...explain]; const repeat = Number(process.argv[2] ?? 1);
const ext = new URL("../../extensions/caveman.ts", import.meta.url).pathname;
const jobs = all.flatMap((c) => ["base", "caveman"].flatMap((mode) => Array.from({ length: repeat }, (_, i) => ({ c, mode, i }))));
const out = join(import.meta.dirname, "results"); mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: 3 }, async () => {
	while (jobs.length) {
		const { c, mode, i } = jobs.shift();
		const dir = join(tmpdir(), "pi-cav", `${c.id}-${mode}-${i}`);
		checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), MARKED_BASE, dir);
		const agent = new PiHarness(dir, "sonnet", undefined, { environment: { PI_CAVEMAN: mode === "caveman" ? "1" : "0" } });
		const t = await agent.runTurn(c.prompt); agent.close();
		const u = t.usage; const cost = u.cacheRead * 0.1 + u.cacheWrite * 1.25 + u.input + u.output * 5;
		const rec = { case: c.id, mode, i, pass: c.check(t.answer), seconds: t.seconds, requests: t.requests, output: u.output, chars: t.answer.length, cost, answer: t.answer };
		appendFileSync(join(out, "caveman-ab.jsonl"), JSON.stringify(rec) + "\n");
		console.log(rec.pass ? "PASS" : "FAIL", c.id, mode, `out=${u.output} chars=${rec.chars}`);
	}
}));
