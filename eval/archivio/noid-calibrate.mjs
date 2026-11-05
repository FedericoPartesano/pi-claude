// Similarity threshold for semantic auto recall: top-1 e5 dot of the 6 noid questions (should fire) against prompts that do not
// ask for old data (should not). Archive = one noid B session. Usage: node eval/archivio/noid-calibrate.mjs <session.jsonl>
import { readFileSync } from "node:fs";
import { archivedEntries, chunkArchive } from "../../extensions/archivio.ts";
import { BackgroundEmbedder } from "../../pi-memory/src/embed.ts";
const embedder = new BackgroundEmbedder();
if (!(await embedder.start())) throw new Error("embedder not ready");
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const branch = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const chunks = chunkArchive(archivedEntries(branch));
import { existsSync, writeFileSync } from "node:fs";
const cachePath = `/tmp/cal-vecs-${process.argv[2].split("/").pop()}.json`;
let vecs = [];
if (existsSync(cachePath)) vecs = JSON.parse(readFileSync(cachePath, "utf8")).map((v) => Float32Array.from(v));
else { for (let i = 0; i < chunks.length; i += 32) vecs.push(...(await embedder.embed(chunks.slice(i, i + 32).map((c) => c.text.slice(0, 900)), "passage"))); writeFileSync(cachePath, JSON.stringify(vecs.map((v) => [...v]))); }
const text = (e) => (typeof e.message.content === "string" ? e.message.content : e.message.content.map((c) => c.text ?? "").join(" "));
const users = branch.filter((e) => e.message?.role === "user").map(text);
const positives = users.filter((t) => /Rispondi solo con il valore/.test(t)).map((t) => t.replace(/ Rispondi.*/, ""));
console.log("n positives", positives.length);
const negatives = ["Scrivi in una riga cosa fa un algoritmo di ordinamento a bolle.", "Dammi tre consigli per scrivere buoni messaggi di commit.", "Qual è la differenza tra una promise e un callback in JavaScript?", "Spiegami in una frase cos'è un indice hash.", "Elenca due vantaggi dei test automatici.", "Come si inverte una stringa in Python? Una riga.", "Che cosa significa l'acronimo REST?", "Suggerisci un nome breve per una funzione che somma due numeri.", "Committa il codice e fai il push", "Perché il build fallisce su Windows?", "Aggiungi un test per la funzione di parsing", "Cosa ne pensi di questa architettura?"];
const top1 = async (q) => {
	const [v] = await embedder.embed([q], "query");
	const sims = vecs.map((x) => dot(v, x)).sort((a, b) => b - a);
	const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
	const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length);
	return { top: sims[0], z: (sims[0] - mean) / sd, gap: sims[0] - sims[1] };
};
const pos = [], neg = [];
for (const q of positives) pos.push(await top1(q));
for (const q of negatives) neg.push(await top1(q));
const f = (a, k) => a.map((x) => x[k].toFixed(2)).join(" ");
for (const k of ["top", "z", "gap"]) console.log(k, "\n pos:", f(pos, k), "\n neg:", f(neg, k), "\n neg(read repeats):", f([], k));
