// Quality + cost of exploration questions: haiku vs sonnet (same Pi, same cases lean/e4-cases.mjs).
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
import { cases, MARKED_BASE } from "../lean/e4-cases.mjs";
const models = (process.argv[2] ?? "haiku,sonnet").split(","); const repeat = Number(process.argv[3] ?? 1);
const jobs = cases.flatMap((c) => models.flatMap((m) => Array.from({ length: repeat }, (_, i) => ({ c, m, i }))));
const out = join(import.meta.dirname, "results"); mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: 3 }, async () => {
	while (jobs.length) {
		const { c, m, i } = jobs.shift();
		const dir = join(tmpdir(), "pi-hs", `${c.id}-${m}-${i}`);
		checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), MARKED_BASE, dir);
		const agent = new PiHarness(dir, m); const t = await agent.runTurn(c.prompt); agent.close();
		const u = t.usage; const cost = u.cacheRead * 0.1 + u.cacheWrite * 1.25 + u.input + u.output * 5;
		const rec = { case: c.id, model: m, i, pass: c.check(t.answer), seconds: t.seconds, requests: t.requests, cost, answer: t.answer.slice(0, 120) };
		appendFileSync(join(out, "haiku-vs-sonnet.jsonl"), JSON.stringify(rec) + "\n");
		console.log(rec.pass ? "PASS" : "FAIL", c.id, m, `req=${rec.requests} cost=${Math.round(cost)} ${rec.seconds}s`);
	}
}));
