// Router quality on real, judge-labelled messages (kept outside the repo: they contain credentials).
// Run: node eval/skills-router/real.mjs [msgs.json labels.json fired.json]   (defaults to /tmp)
// Split: even ids = tuning set, odd ids = holdout. Unfired messages are a random sample: weighted by population/sample.
import { readFileSync } from "node:fs";
import { loadRouter, route } from "../../extensions/skills-router.ts";
const [mf = "/tmp/real-msgs.json", lf = "/tmp/labels.json", ff = "/tmp/fired.json"] = process.argv.slice(2);
const msgs = JSON.parse(readFileSync(mf, "utf8")).map((x) => x.t);
const labels = JSON.parse(readFileSync(lf, "utf8"));
const base = new Set(JSON.parse(readFileSync(ff, "utf8")).map((x) => x.i)); // fired by the v1 router (selection frame)
const key = { "debugging-and-error-recovery": "debugging", "test-driven-development": "tdd", "code-review-and-quality": "code-review", "spec-driven-development": "spec", "planning-and-task-breakdown": "planning", "idea-refine": "idea-refine", "security-and-hardening": "security", "performance-optimization": "performance", "code-simplification": "simplification", "git-workflow-and-versioning": "git", "documentation-and-adrs": "docs", "frontend-ui-engineering": "frontend", "api-and-interface-design": "api", "shipping-and-launch": "shipping" };
const router = { ...loadRouter(new URL("../../skills", import.meta.url).pathname) };
if (process.env.AUTO) router.autoThreshold = +process.env.AUTO;
const nUnfired = msgs.filter((m, i) => !base.has(i) && m.length >= 15).length;
const sample = Object.keys(labels).filter((i) => !base.has(+i)).length;
const wUn = nUnfired / sample;
for (const [name, pick] of [["tuning", (i) => i % 2 === 0], ["holdout", (i) => i % 2 === 1]]) {
	let tp = 0, fp = 0, want = 0, hit = 0, firedMsgs = 0;
	for (const [k, lab] of Object.entries(labels)) {
		const i = +k; if (!pick(i)) continue;
		const w = base.has(i) ? 1 : wUn;
		const got = route(router, { message: msgs[i] }).filter((a) => a.tier === "auto").map((a) => key[a.skill.split("/").pop()]);
		const ok = got.filter((g) => lab.includes(g));
		tp += ok.length * w; fp += (got.length - ok.length) * w; want += lab.length * w; hit += ok.length * w; if (got.length) firedMsgs += w;
	}
	console.log(`${name}: precisione ${(100 * tp / (tp + fp)).toFixed(0)}% · richiamo ${(100 * hit / want).toFixed(0)}% · attivazioni stimate ${Math.round(tp + fp)} su ${msgs.length} (${(100 * (tp + fp) / msgs.length).toFixed(1)}%)`);
}
