// Router quality on labelled cases: with the extension (router) vs without (nothing ever activates).
// Run: node eval/skills-router/run.mjs   (Node >= 22.19)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRouter, route } from "../../extensions/skills-router.ts";

const root = join(import.meta.dirname, "..", "..", "skills");
const router = loadRouter(root);
const cases = JSON.parse(readFileSync(join(import.meta.dirname, "cases.json"), "utf8"));
const name = (s) => s.split("/").pop();
const size = (s) => { try { return readFileSync(join(root, s, "SKILL.md"), "utf8").replace(/^---[\s\S]*?\n---\n/, "").length / 4; } catch { return 0; } };

let tp = 0, fp = 0, fn = 0, neutral = 0, neutralFalse = 0, wanted = 0, tokens = 0, fired = 0;
const rows = [];
for (const c of cases) {
	const got = route(router, { message: c.m, repo: c.repo }).filter((a) => a.tier === "auto").map((a) => name(a.skill));
	const hit = got.filter((g) => c.e.includes(g));
	const extra = got.filter((g) => !c.e.includes(g));
	const ok = c.e.length ? hit.length > 0 : got.length === 0;
	if (c.e.length) { wanted++; if (hit.length) tp++; else fn++; } else { neutral++; if (got.length) neutralFalse++; }
	fp += extra.length;
	for (const a of route(router, { message: c.m, repo: c.repo }).filter((a) => a.tier === "auto")) { tokens += size(a.skill); fired++; }
	rows.push({ ok, m: c.m, e: c.e, got });
}
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : "n/a");
for (const r of rows.filter((r) => !r.ok)) console.log(`✖ «${r.m}» atteso [${r.e}] ottenuto [${r.got}]`);
console.log(`\ncasi ${cases.length} (con skill attesa ${wanted}, neutri ${neutral})`);
console.log(`CON estensione   richiamo ${pct(tp, wanted)} (${tp}/${wanted}) · attivazioni sbagliate ${fp} · falsi su neutri ${neutralFalse}/${neutral} · casi giusti ${rows.filter((r) => r.ok).length}/${cases.length} (${pct(rows.filter((r) => r.ok).length, cases.length)})`);
console.log(`SENZA estensione richiamo 0% (0/${wanted}) · attivazioni sbagliate 0 · falsi su neutri 0/${neutral} · casi giusti ${neutral}/${cases.length} (${pct(neutral, cases.length)})`);
console.log(`precisione (attivazioni utili / totali) ${pct(tp, tp + fp)} · token medi iniettati per attivazione ${fired ? Math.round(tokens / fired) : 0} (${fired} attivazioni)`);
