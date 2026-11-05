// Offline retrieval bench for the archive WITHOUT identifiers in the question.
// gen: samples chunks of real compacted sessions and asks haiku for a paraphrased question (no file names, numbers or
//      literal strings from the chunk). run: compares BM25 (current), BM25 with light stemming (B), e5 cosine and
//      RRF(BM25, e5) (A) by recall@1/@3: the gold chunk, or any chunk of the same entry, is in the top k.
// Usage: node eval/archivio/retrieval-bench.mjs gen <out.json> <N per session> <session.jsonl>...
//        node eval/archivio/retrieval-bench.mjs run <questions.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { archivedEntries, chunkArchive, search, tokens } from "../../extensions/archivio.ts";

const [mode, file, ...rest] = process.argv.slice(2);
const load = (path) => {
	const branch = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
	return chunkArchive(archivedEntries(branch));
};
const ask = (prompt) => new Promise((resolve) => {
	const child = spawn("claude", ["-p", "--model", process.env.JUDGE_MODEL ?? "haiku", "--tools", ""], { cwd: "/tmp" });
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	child.stdin.end(prompt);
	child.on("close", () => resolve(out.trim()));
});

if (mode === "gen") {
	const per = Number(rest[0]);
	const items = [];
	for (const path of rest.slice(1)) {
		const chunks = load(path);
		const pool = chunks.map((c, i) => ({ c, i })).filter(({ c }) => c.text.length >= 500 && /[a-zàèéìòù]{4,} [a-zàèéìòù]{4,} [a-zàèéìòù]{4,}/i.test(c.text));
		const step = Math.max(1, Math.floor(pool.length / per));
		const picks = [];
		for (let i = Math.floor(step / 2); i < pool.length && picks.length < per; i += step) picks.push(pool[i]);
		let next = 0;
		const worker = async () => {
			while (next < picks.length) {
				const { c, i } = picks[next++];
				const prompt = `Sotto c'è un estratto di una vecchia conversazione di lavoro (programmazione). Scrivi UNA domanda in italiano che un utente farebbe più tardi per ritrovare questo contenuto. Regole: parafrasa; NON usare nomi di file, percorsi, numeri, nomi di funzioni o stringhe letterali presenti nell'estratto; descrivi l'argomento a parole tue. Rispondi solo con la domanda.\n\n---\n${c.text.slice(0, 900)}\n---`;
				const question = (await ask(prompt)).split("\n")[0].replace(/^["«]|["»]$/g, "");
				if (question.length > 15) items.push({ session: path.split("/").pop(), chunkIndex: i, entryId: c.entryId, question });
			}
		};
		await Promise.all([worker(), worker(), worker(), worker()]);
		items.forEach((it) => it.session === path.split("/").pop() && (it.path = path));
	}
	writeFileSync(file, JSON.stringify(items, null, 1));
	console.log(`questions: ${items.length}`);
} else if (mode === "judge") {
	// Pooled relevance: haiku marks which of the pooled top-3 chunks (union over methods) answer the question.
	const ranks = JSON.parse(readFileSync(file, "utf8"));
	const cache = new Map();
	const out = [];
	let next = 0;
	const worker = async () => {
		while (next < ranks.length) {
			const r = ranks[next++];
			if (!cache.has(r.path)) cache.set(r.path, load(r.path));
			const chunks = cache.get(r.path);
			const pool = [...new Set([r.gold, ...Object.values(r.rank).flatMap((l) => l.slice(0, 3))])].filter((i) => i !== undefined);
			const listing = pool.map((i) => `[${i}] ${chunks[i].text.slice(0, 450)}`).join("\n\n");
			const answer = await ask(`Domanda: ${r.question}\n\nEstratti candidati:\n\n${listing}\n\nQuali estratti contengono informazione che aiuta davvero a rispondere alla domanda? Rispondi solo con una lista JSON dei numeri tra parentesi quadre, es. [12,40], oppure [].`);
			const match = /\[[\d,\s]*\]/.exec(answer);
			out.push({ ...r, relevant: match ? JSON.parse(match[0]) : null });
		}
	};
	await Promise.all([worker(), worker(), worker(), worker()]);
	writeFileSync(file.replace(/\.json$/, "-judged.json"), JSON.stringify(out));
	const score = {};
	for (const r of out) {
		if (!r.relevant) continue;
		const rel = new Set(r.relevant);
		for (const [name, list] of Object.entries(r.rank)) {
			const x = (score[name] ??= { n: 0, h1: 0, h3: 0, p3: 0 });
			x.n++; x.h1 += rel.has(list[0]) ? 1 : 0; x.h3 += list.slice(0, 3).some((i) => rel.has(i)) ? 1 : 0; x.p3 += list.slice(0, 3).filter((i) => rel.has(i)).length / 3;
		}
	}
	console.log(`judged ${out.filter((r) => r.relevant).length}/${out.length}; questions with no relevant chunk: ${out.filter((r) => r.relevant && r.relevant.length === 0).length}`);
	for (const [name, x] of Object.entries(score)) console.log(`${name.padEnd(9)} n=${x.n} hit@1=${(x.h1 / x.n).toFixed(2)} hit@3=${(x.h3 / x.n).toFixed(2)} precision@3=${(x.p3 / x.n).toFixed(2)}`);
} else {
	const { BackgroundEmbedder } = await import("../../pi-memory/src/embed.ts");
	const items = JSON.parse(readFileSync(file, "utf8"));
	const embedder = new BackgroundEmbedder();
	if (!(await embedder.start())) throw new Error("embedder not ready");
	const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w.length > 4 ? w.replace(/[aeio]$/, "") : w);
	const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
	const K = [1, 3, 10];
	const stats = {};
	const saved = [];
	const add = (name, ok, ms) => { const s = (stats[name] ??= { n: 0, r1: 0, r3: 0, r10: 0, ms: 0 }); s.n++; s.r1 += ok[0]; s.r3 += ok[1]; s.r10 += ok[2]; s.ms += ms; };
	for (const path of [...new Set(items.map((i) => i.path))]) {
		const chunks = load(path);
		const mine = items.filter((i) => i.path === path);
		const stemmed = chunks.map((c, idx) => ({ ...c, text: tokens(c.text).map(stem).join(" "), idx }));
		const t0 = Date.now();
		const cache = `/tmp/rb-vecs-${path.split("/").pop()}.json`;
		let vecs = [];
		if (existsSync(cache)) vecs = JSON.parse(readFileSync(cache, "utf8")).map((v) => Float32Array.from(v));
		else {
			for (let i = 0; i < chunks.length; i += 32) vecs.push(...(await embedder.embed(chunks.slice(i, i + 32).map((c) => c.text.slice(0, 900)), "passage")));
			writeFileSync(cache, JSON.stringify(vecs.map((v) => [...v])));
		}
		console.error(`${path.slice(-24)}: ${chunks.length} chunks embedded in ${Math.round((Date.now() - t0) / 1000)}s`);
		const indexOf = new Map(chunks.map((c, i) => [c, i]));
		for (const it of mine) {
			const gold = (idx) => chunks[idx].entryId === it.entryId;
			const rank = {};
			let t = Date.now();
			rank.bm25 = search(chunks, it.question, 20).map((h) => indexOf.get(chunks.find((c) => c.entryId === h.entryId && c.text === h.text)));
			const tBm = Date.now() - t;
			t = Date.now();
			rank.bm25stem = search(stemmed, tokens(it.question).map(stem).join(" "), 20).map((h) => h.idx);
			const tSt = Date.now() - t;
			t = Date.now();
			const [q] = await embedder.embed([it.question], "query");
			const sims = vecs.map((v, i) => [i, dot(q, v)]).sort((a, b) => b[1] - a[1]);
			rank.e5 = sims.slice(0, 20).map((s) => s[0]);
			const tE5 = Date.now() - t;
			const fuse = (...lists) => {
				const score = new Map();
				for (const list of lists) list.forEach((idx, r) => score.set(idx, (score.get(idx) ?? 0) + 1 / (60 + r + 1)));
				return [...score].sort((a, b) => b[1] - a[1]).map((s) => s[0]);
			};
			rank.rrf = fuse(rank.bm25, rank.e5);
			rank.rrfstem = fuse(rank.bm25stem, rank.e5);
			if (process.env.DUMP) console.error(JSON.stringify({ q: it.question.slice(0, 90), gold: chunks.findIndex((c) => c.entryId === it.entryId), e5: rank.e5.slice(0, 3), bm: rank.bm25stem.slice(0, 3) }));
			saved.push({ path, question: it.question, gold: it.chunkIndex, rank: Object.fromEntries(Object.entries(rank).map(([n, l]) => [n, l.slice(0, 10)])) });
			const times = { bm25: tBm, bm25stem: tSt, e5: tE5, rrf: tBm + tE5, rrfstem: tSt + tE5 };
			for (const [name, list] of Object.entries(rank)) add(name, K.map((k) => (list.slice(0, k).some((idx) => idx !== undefined && gold(idx)) ? 1 : 0)), times[name]);
		}
	}
	writeFileSync(file.replace(/\.json$/, "-ranks.json"), JSON.stringify(saved));
	for (const [name, s] of Object.entries(stats)) console.log(`${name.padEnd(9)} n=${s.n} recall@1=${(s.r1 / s.n).toFixed(2)} recall@3=${(s.r3 / s.n).toFixed(2)} recall@10=${(s.r10 / s.n).toFixed(2)} ms/query=${Math.round(s.ms / s.n)}`);
}
