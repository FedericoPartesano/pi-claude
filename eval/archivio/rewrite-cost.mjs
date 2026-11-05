// Token cost of one query rewrite through `claude -p` (the only route with the subscription), weighted like the A/B bench
// (input 1, cacheRead 0.1, cacheWrite 1.25, output 5). Two variants: default claude -p prompt, and a minimal system prompt.
// Usage: node eval/archivio/rewrite-cost.mjs <questions.json> [N]
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const items = JSON.parse(readFileSync(process.argv[2], "utf8")).slice(0, Number(process.argv[3] ?? 8));
const weigh = (u) => (u.input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0);
for (const [name, extra] of [["minimal", ["--system-prompt", "Rispondi solo come richiesto.", "--setting-sources", "", "--disable-slash-commands", "--strict-mcp-config", "--no-session-persistence"]]]) {
	const rows = [];
	for (const it of items) {
		const prompt = `Un utente cerca in una lunga sessione di lavoro (programmazione) un contenuto vecchio. Domanda: "${it.question}"\n\nScrivi 3 query di ricerca per parole chiave, una per riga, 4-8 termini ciascuna, che probabilmente compaiono nel testo originale. Solo le 3 righe.`;
		const r = spawnSync("claude", ["-p", "--model", "haiku", "--tools", "", "--output-format", "json", ...extra], { cwd: "/tmp", input: prompt, encoding: "utf8" });
		try { const j = JSON.parse(r.stdout); rows.push({ ...j.usage, w: weigh(j.usage) }); } catch { /* skip */ }
	}
	const avg = (k) => Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length);
	console.log(`${name}: n=${rows.length} input=${avg("input_tokens")} cacheRead=${avg("cache_read_input_tokens")} cacheWrite=${avg("cache_creation_input_tokens")} output=${avg("output_tokens")} weighted=${avg("w")}`);
}
