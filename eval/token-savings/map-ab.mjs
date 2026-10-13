// A/B: Pi base vs Pi + project-map (same model), 10 exploration questions on marked.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PiHarness } from "../harness.mjs";
import { checkoutAt } from "../round2/workdir.mjs";
import { cases, MARKED_BASE } from "../lean/e4-cases.mjs";
const repeat = Number(process.argv[2] ?? 2);
const ext = new URL("../../extensions/project-map.ts", import.meta.url).pathname;
const jobs = cases.flatMap((c) => ["base", "map"].flatMap((mode) => Array.from({ length: repeat }, (_, i) => ({ c, mode, i }))));
const out = join(import.meta.dirname, "results"); mkdirSync(out, { recursive: true });
await Promise.all(Array.from({ length: 3 }, async () => {
	while (jobs.length) {
		const { c, mode, i } = jobs.shift();
		const dir = join(tmpdir(), "pi-map", `${c.id}-${mode}-${i}`);
		checkoutAt(join(homedir(), ".cache/pi-eval/repos/marked"), MARKED_BASE, dir);
		const agent = new PiHarness(dir, "sonnet", undefined, { extraArgs: mode === "map" ? ["-e", ext] : [] });
		const t = await agent.runTurn(c.prompt); agent.close();
		const u = t.usage; const cost = u.cacheRead * 0.1 + u.cacheWrite * 1.25 + u.input + u.output * 5;
		const rec = { case: c.id, mode, i, pass: c.check(t.answer), seconds: t.seconds, requests: t.requests, cost, answer: t.answer.slice(0, 100) };
		appendFileSync(join(out, "map-ab.jsonl"), JSON.stringify(rec) + "\n");
		console.log(rec.pass ? "PASS" : "FAIL", c.id, mode, `req=${rec.requests} cost=${Math.round(cost)} ${rec.seconds}s`);
	}
}));
