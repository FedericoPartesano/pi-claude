// Compares answer styles (plain, caveman full, STE) with the same 8 technical questions: output tokens and a simple STE linter.
// Runs from an empty cwd with no settings (the repo CLAUDE.md would make every answer caveman). Usage: node eval/ste/run.mjs [model]. Calls `claude -p` with the style appended to the system prompt, no tools.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { RULES as CAVEMAN } from "../../extensions/caveman.ts";
import { RULES as STE, COMBO } from "../../extensions/ste.ts";

const model = process.argv[2] ?? "haiku";
const QUESTIONS = [
	"How do I find which process listens on port 8080 on Linux, and how do I stop it?",
	"Explain the difference between a mutex and a semaphore.",
	"A Node.js script leaks memory. How do I find the cause?",
	"How do I undo the last git commit but keep the changes?",
	"What is the difference between TCP and UDP and when do I use each one?",
	"How do I rotate a log file safely with logrotate?",
	"Why does my Docker container exit immediately, and how do I debug it?",
	"How do I add an index to a slow PostgreSQL query and check that it helps?",
];
const STYLES = { plain: "", caveman: CAVEMAN, ste: STE, combo: COMBO };

const lint = (text) => {
	const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
	const sentences = prose.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /\w/.test(s));
	const words = (s) => s.split(/\s+/).filter(Boolean).length;
	const ing = (prose.match(/\b\w{3,}ing\b/gi) ?? []).filter((w) => !/^(string|thing|something|nothing|anything|everything|during|morning|ring|spring|king|bring|ping|logging|routing|networking|caching|indexing|processing|buffering|scheduling)$/i.test(w)).length;
	const passive = (prose.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi) ?? []).length;
	const long = sentences.filter((s) => words(s) > 25).length;
	return { sentences: sentences.length, words: words(prose), avgWords: +(words(prose) / Math.max(1, sentences.length)).toFixed(1), long, ing, passive, violations: long + ing + passive };
};

const run = promisify(execFile);
const rows = [];
await Promise.all(Object.entries(STYLES).map(async ([style, rules]) => {
	for (const [i, q] of QUESTIONS.entries()) {
		const args = ["-p", q, "--model", model, "--output-format", "json", "--tools", "", "--setting-sources", "", ...(rules ? ["--append-system-prompt", rules] : [])];
		const call = async () => JSON.parse((await run("claude", args, { encoding: "utf8", timeout: 90_000, cwd: "/tmp/ste-cwd" })).stdout);
		let out; try { out = await call(); } catch { out = await call(); } // one retry: a call sometimes hangs
		const text = String(out.result ?? "");
		const thinking = out.usage?.output_tokens_details?.thinking_tokens ?? 0;
		rows.push({ style, q: i, outTokens: out.usage?.output_tokens ?? 0, thinking, textTokens: (out.usage?.output_tokens ?? 0) - thinking, chars: text.length, text, ...lint(text) });
		console.error(style, i, rows.at(-1).textTokens, thinking);
	}
}));
writeFileSync(new URL("results.json", import.meta.url), JSON.stringify(rows, null, 1));
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const sum = (a) => a.reduce((x, y) => x + y, 0);
for (const style of Object.keys(STYLES)) {
	const r = rows.filter((x) => x.style === style);
	console.log(style.padEnd(8), "total", sum(r.map((x) => x.outTokens)), "| thinking", sum(r.map((x) => x.thinking)), "| text tok", sum(r.map((x) => x.textTokens)), "| chars", sum(r.map((x) => x.chars)), "| long>25", sum(r.map((x) => x.long)), "| -ing", sum(r.map((x) => x.ing)), "| passive", sum(r.map((x) => x.passive)), "| avg sentence", med(r.map((x) => x.avgWords)));
}
