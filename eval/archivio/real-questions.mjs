// Real questions: user prompts from sessions with >=5 compactions that ask for something said earlier, without identifiers.
// Step 1 (select): per session, prompts after a compaction, 40-400 chars, no path/number/camelCase; haiku keeps those that
//   need information from earlier in the conversation. The archive at that moment = entries before that compaction's kept point.
// Usage: node eval/archivio/real-questions.mjs select <out.json> <max per session> <session.jsonl>...
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { archivedEntries, chunkArchive, contentText } from "../../extensions/archivio.ts";
const [mode, out, maxPer, ...files] = process.argv.slice(2);
const ask = (prompt) => new Promise((resolve) => {
	const child = spawn("claude", ["-p", "--model", "haiku", "--tools", ""], { cwd: "/tmp" });
	let o = "";
	child.stdout.on("data", (d) => (o += d));
	child.stdin.end(prompt);
	child.on("close", () => resolve(o.trim()));
});
const ident = /[\w./-]+\.(ts|js|md|json|py|mjs|sh)\b|\/[\w.-]+\/|\b\d{3,}\b|\b[a-z]+[A-Z]\w{3,}\b|\b\w+_\w+\b|`/;
const result = [];
for (const path of files) {
	const branch = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
	const finalCount = chunkArchive(archivedEntries(branch)).length;
	const cands = [];
	let compactions = 0;
	branch.forEach((e, i) => {
		if (e.type === "compaction") compactions++;
		if (compactions < 5 || e.type !== "message" || e.message?.role !== "user") return;
		const text = contentText(e.message.content).trim();
		if (text.length < 40 || text.length > 400 || ident.test(text) || /^\/|archive-recall|<system/.test(text)) return;
		const archive = chunkArchive(archivedEntries(branch.slice(0, i)));
		if (archive.length < 200) return;
		cands.push({ i, text, size: archive.length, compactions });
	});
	const step = Math.max(1, Math.floor(cands.length / (Number(maxPer) * 2)));
	let kept = 0;
	for (let k = 0; k < cands.length && kept < Number(maxPer); k += step) {
		const c = cands[k];
		const verdict = await ask(`Messaggio di un utente a un assistente di programmazione, a metà di una lunga sessione:\n"${c.text}"\n\nIl messaggio chiede di ritrovare o usare un'informazione dettagliata detta o fatta molto prima nella conversazione (non un'istruzione nuova autosufficiente)? Rispondi solo SI o NO.`);
		if (/^si|^sì/i.test(verdict)) { result.push({ session: path.split("/").pop(), path, question: c.text, archiveSize: c.size, compactions: c.compactions }); kept++; }
	}
	console.error(`${path.split("/").pop().slice(0, 24)}: ${cands.length} candidates, kept ${kept}, final archive ${finalCount}`);
}
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`real questions: ${result.length}`);
