// Offline check of eval/fold/results.txt: the improved profile (t-v2..t-v4) must cost less than off (t-off3..t-off5)
// and keep a smaller live context. Re-running the live bench costs ~2.6M tokens; this reads the recorded runs.
import { readFileSync } from "node:fs";
const rows = new Map();
for (const line of readFileSync(new URL("./results.txt", import.meta.url), "utf8").split("\n")) {
	const space = line.indexOf(" {");
	if (space > 0) rows.set(line.slice(0, space), JSON.parse(line.slice(space + 1)));
}
const weighted = (r) => r.input + 0.1 * r.cacheRead + 1.25 * r.cacheWrite + 5 * r.output;
const mean = (labels, f) => labels.reduce((sum, l) => sum + f(rows.get(l)), 0) / labels.length;
const off = ["t-off3", "t-off4", "t-off5"], v2 = ["t-v2", "t-v3", "t-v4"];
const out = {
	totalIn: [mean(off, (r) => r.totalIn), mean(v2, (r) => r.totalIn)],
	weighted: [mean(off, weighted), mean(v2, weighted)],
	maxCtx: [mean(off, (r) => r.maxCtx), mean(v2, (r) => r.maxCtx)],
	piCompactions: [mean(off, (r) => r.compaction.compaction_start ?? 0), mean(v2, (r) => r.compaction.compaction_start ?? 0)],
};
console.log(JSON.stringify(out));
const ok = Object.values(out).every(([a, b]) => b < a) && v2.every((l) => weighted(rows.get(l)) < Math.min(...off.map((o) => weighted(rows.get(o)))));
if (!ok) { console.error("v2 is not cheaper than off on every measure"); process.exit(1); }

// Long chat (eval/fold/long.py, 29 turns with a restart, quiz of 14 values twice): the default profile vB must cost
// less than off, restart the bridge less, never run Pi's compaction and recall every value before and after the restart.
const lOff = ["long-N-off1", "long-N-off2"], lV = ["long-N-v1", "long-N-v2"];
const long = {
	weighted: [mean(lOff, weighted), mean(lV, weighted)],
	spawns: [mean(lOff, (r) => r.spawns), mean(lV, (r) => r.spawns)],
	maxCtx: [mean(lOff, (r) => r.maxCtx), mean(lV, (r) => r.maxCtx)],
};
console.log(JSON.stringify({ long }));
const fullRecall = [...lOff, ...lV].every((l) => rows.get(l).recall.every((r) => r === "14/14"));
if (!Object.values(long).every(([a, b]) => b < a) || !fullRecall || lV.some((l) => rows.get(l).compaction.compaction_start)) {
	console.error("long chat: vB is not cheaper than off, or a value was lost");
	process.exit(1);
}
