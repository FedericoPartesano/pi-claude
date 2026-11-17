// Precision/recall on a FRESH labelled sample (messages never used while writing the rules).
// Run: node eval/skills-router/fresh.mjs   (needs /tmp/real-msgs.json, /tmp/fresh-ids.json, /tmp/labels-fresh.json)
import { readFileSync } from "node:fs";
import { loadRouter, route } from "../../extensions/skills-router.ts";
const msgs = JSON.parse(readFileSync("/tmp/real-msgs.json", "utf8")).map((x) => x.t);
const F = JSON.parse(readFileSync("/tmp/fresh-ids.json", "utf8"));
const labels = JSON.parse(readFileSync("/tmp/labels-fresh.json", "utf8"));
const key = { "debugging-and-error-recovery": "debugging", "test-driven-development": "tdd", "code-review-and-quality": "code-review", "spec-driven-development": "spec", "planning-and-task-breakdown": "planning", "idea-refine": "idea-refine", "security-and-hardening": "security", "performance-optimization": "performance", "code-simplification": "simplification", "git-workflow-and-versioning": "git", "documentation-and-adrs": "docs", "frontend-ui-engineering": "frontend", "api-and-interface-design": "api", "shipping-and-launch": "shipping" };
const router = loadRouter(new URL("../../skills", import.meta.url).pathname);
const restPop = F.poolSize - F.fired.length;
const wRest = restPop / F.rest.length;
const fired = new Set(F.fired);
const stat = { auto: { tp: 0, fp: 0, n: 0, nTp: 0, nFp: 0 }, suggest: { tp: 0, fp: 0, n: 0, nTp: 0, nFp: 0 } };
let want = 0, hitAuto = 0, hitAny = 0, t0 = performance.now(), calls = 0;
const show = process.argv.includes("--fp");
for (const [k, lab] of Object.entries(labels)) {
	const i = +k, w = fired.has(i) ? 1 : wRest;
	const got = route(router, { message: msgs[i] }); calls++;
	want += lab.length * w;
	for (const a of got) {
		const ok = lab.includes(key[a.skill.split("/").pop()]);
		const s = stat[a.tier]; s[ok ? "tp" : "fp"] += w; s[ok ? "nTp" : "nFp"]++;
		if (ok) { hitAny += w; if (a.tier === "auto") hitAuto += w; }
		if (show && !ok && a.tier === "auto") console.log("FP", key[a.skill.split("/").pop()], JSON.stringify(msgs[i].slice(0, 120)), lab);
	}
}
const ms = (performance.now() - t0) / calls;
const wilson = (p, n) => { const z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
for (const t of ["auto", "suggest"]) {
	const s = stat[t], n = s.nTp + s.nFp;
	const [lo, hi] = wilson(n ? s.nTp / n : 0, n);
	console.log(`${t}: precisione ${(100 * s.tp / (s.tp + s.fp)).toFixed(0)}% (senza pesi ${s.nTp}/${n}, IC95% ${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)}%) · attivazioni stimate ${Math.round(s.tp + s.fp)} su ${F.poolSize}`);
}
console.log(`richiamo auto ${(100 * hitAuto / want).toFixed(0)}% · auto+suggerimento ${(100 * hitAny / want).toFixed(0)}% · ${ms.toFixed(3)} ms/messaggio`);
