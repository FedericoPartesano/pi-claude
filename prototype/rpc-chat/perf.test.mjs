// Per-component micro benchmarks of the chat client: `node --test prototype/rpc-chat/perf.test.mjs`.
// PERF_ONLY=markdown filters by name, PERF_VERBOSE=1 prints the table also when everything is within budget.
// Budgets are loose (about 10x the values measured on a laptop) to catch order-of-magnitude regressions without flaking;
// the numbers are the point: compare them before/after a change.
// Debug one component: PERF_ONLY="frame" node --inspect-brk --test prototype/rpc-chat/perf.test.mjs  ·  or  node --cpu-prof --test-concurrency=1 …
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, bench } from "./perf-harness.mjs";

const only = process.env.PERF_ONLY;
const rows = [];
const check = (name, budgetUs, fn, opts) => {
	test(name, { skip: only && !name.includes(only) }, () => {
		const r = bench(fn, opts);
		rows.push(`${name.padEnd(46)} ${r.us.toFixed(1).padStart(10)} µs  (min ${r.min.toFixed(1)}, max ${r.max.toFixed(1)}, budget ${budgetUs})`);
		assert.ok(r.us <= budgetUs, `${name}: ${r.us.toFixed(1)} µs > budget ${budgetUs} µs`);
	});
};
let printed = false;
const print = () => { if (!printed && rows.length && (process.env.PERF_VERBOSE || process.exitCode)) { printed = true; console.log(`\n${rows.join("\n")}`); } };
process.on("beforeExit", print);
process.on("exit", print);

const W = 80;
const PARA = "Il mare copre circa il 71% della superficie terrestre; la salinita media vale circa 35 g/kg e dipende da latitudine, temperatura e apporti dei fiumi. ".repeat(3);
const MD = `${PARA}\n\n• punto uno con **grassetto** e \`codice\`\n• punto due con [link](https://example.com)\n\n1. prima fase\n2. seconda fase con un testo piu lungo che va a capo perche supera la larghezza\n\n\`\`\`js\nfunction f(n) {\n  return Array.from({ length: n }, (_, i) => i * 4);\n}\n\`\`\`\n\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n`;
const colored = `\x1b[38;2;220;223;232m${PARA}\x1b[0m`;

const c = load({ columns: 140, rows: 40 });
const { S, R } = c;

check("width_  (300 chars, ANSI)", 400, () => c.width_(colored));
check("cut     (300 chars → 60)", 400, () => c.cut(colored, 60));
check("wrap    (paragraph, 80 cols)", 2000, () => c.wrap(PARA, W));
check("hardWrap (prompt, 300 chars)", 1000, () => c.hardWrap(PARA, W));
check("markdown (mixed doc, 80 cols)", 3000, () => c.markdown(MD, W));
check("markdown (code block only)", 4000, () => c.markdown("```js\n" + "const a = 1;\n".repeat(30) + "```", W));
check("markdown (table)", 4000, () => c.markdown("| a | b |\n|---|---|\n" + "| 1 | 2 |\n".repeat(10), W));
check("toolLine (done)", 60, () => c.toolLine({ name: "bash", args: { command: "node --test extensions/*.test.ts" }, done: true, ms: 2400 }, W));
check("diffRows (40-line patch)", 4000, () => c.diffRows(Array.from({ length: 40 }, (_, i) => (i % 3 ? `+ riga ${i}` : `- riga ${i}`)).join("\n"), W));
check("popup   (/ commands, 8 results)", 300, () => { c.state.input = "/re"; c.state.cursor = 3; return c.popup(); });
check("fuzzy   (query vs path)", 5, () => c.fuzzy("chat", "prototype/rpc-chat/chat.mjs"));

// Incremental markdown must give exactly the same lines as the full render, at every prefix of the text.
test("streamMarkdown == markdown at every prefix", { skip: only && !"streamMarkdown".includes(only) }, () => {
	const t = MD + "\n" + MD;
	const blk = { kind: "assistant", text: "" };
	for (let n = 0; n <= t.length; n += 7) {
		blk.text = t.slice(0, n);
		assert.deepEqual(c.streamMarkdown(blk, blk.text, W), c.markdown(blk.text, W), `prefix ${n}`);
	}
});
{
	const blk = { kind: "assistant", text: MD.repeat(3) };
	check("markdown (3 docs, full render)", 8000, () => c.markdown(blk.text, W));
	check("streamMarkdown (3 docs, +1 char)", 8000, () => { blk.text += "x"; return c.streamMarkdown(blk, blk.text, W); });
}

// Block cache: a closed block must cost a lookup, not a re-render.
const closed = { kind: "assistant", text: MD };
c.blocks.push(closed);
c.blockLines(closed, W);
check("blockLines (closed, cache hit)", 100, () => c.blockLines(closed, W));
check("blockLines (streaming block, miss)", 3000, () => { c.state.open = closed; const r = c.blockLines(closed, W); c.state.open = undefined; return r; });

// Whole conversation: 300 closed blocks + one streaming — what a long session pays per frame.
for (let i = 0; i < 150; i++) {
	c.blocks.push({ kind: "user", text: `domanda numero ${i} con un po' di testo` });
	c.blocks.push({ kind: "assistant", text: MD });
}
check("bodyLines (300 closed blocks)", 4000, () => c.bodyLines(W));
const live = { kind: "assistant", text: MD };
c.blocks.push(live);
c.state.open = live;
check("bodyLines (300 closed + 1 streaming)", 8000, () => c.bodyLines(W));
c.state.open = undefined;

c.statuses.set("intent", "rendi il prototipo come predefinita");
c.state.plan = Array.from({ length: 8 }, (_, i) => ({ subject: `passo ${i}`, status: i < 3 ? "completed" : "pending" }));
check("sideLines (full panel)", 800, () => c.sideLines(33));

// Frame: first paint (everything written) vs the same frame again (nothing to write).
c.state.sideVer = 1;
check("frame   (full repaint)", 12000, () => { c.state.previous = []; c.state.shownKitty = new Set(); c.written.length = 0; c.frame(); return c.written.length; });
check("frame   (nothing changed)", 4000, () => { c.written.length = 0; c.frame(); return c.written.length; });
check("frame   (streaming: 1 char appended)", 8000, () => { live.text += "x"; c.state.open = live; c.written.length = 0; c.frame(); return c.written.length; });
check("frame   (typing 1 key in prompt)", 4000, () => { c.state.open = undefined; c.state.input += "a"; c.state.cursor = c.state.input.length; c.written.length = 0; c.frame(); return c.written.length; });
