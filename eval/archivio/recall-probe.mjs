// Offline probe: can `richiama` find a detail from before a real compaction?
// For each compacted session, probes are built from the archived text: a distinctive token (path, number, identifier)
// is the answer; the query is 4 neighbouring words WITHOUT it. Hit = the chunk with the token is in the top k.
// Usage: node eval/archivio/recall-probe.mjs <session.jsonl>... (env K=4, PROBES=60)
import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive, search, tokens } from "../../extensions/archivio.ts";

const K = Number(process.env.K ?? 4);
const PROBES = Number(process.env.PROBES ?? 60);
let total = 0, found = 0, outChars = 0;
for (const file of process.argv.slice(2)) {
	const branch = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
	const chunks = chunkArchive(archivedEntries(branch));
	if (chunks.length === 0) continue;
	const picks = chunks.filter((c) => /[\w./-]+\.(ts|js|md|json|py):\d+|\b\d{4,}\b|\b[a-z]+[A-Z]\w{5,}\b/.test(c.text));
	const step = Math.max(1, Math.floor(picks.length / PROBES));
	for (let i = 0; i < picks.length && total < PROBES * process.argv.length; i += step) {
		const chunk = picks[i];
		const answer = /[\w./-]+\.(ts|js|md|json|py):\d+|\b\d{4,}\b|\b[a-z]+[A-Z]\w{5,}\b/.exec(chunk.text)[0];
		const words = tokens(chunk.text.replace(answer, " ")).filter((w) => w.length > 4);
		const at = Math.floor(words.length / 3);
		const query = words.slice(at, at + 4).join(" ");
		if (!query) continue;
		const hits = search(chunks, query, K);
		total++;
		if (hits.some((h) => h.text.includes(answer))) found++;
		outChars += hits.reduce((s, h) => s + h.text.length, 0);
	}
}
console.log(JSON.stringify({ probes: total, found, rate: Math.round((100 * found) / total) / 100, k: K, avgExcerptChars: Math.round(outChars / total) }));
