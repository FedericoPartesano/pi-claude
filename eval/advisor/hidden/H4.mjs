import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unifiedDiff } from "./diff.js";
const fail = (m) => { throw new Error(m); };
const stats = { total: 0, failed: [] };
const attempt = (label, fn) => { stats.total++; try { fn(); } catch (e) { stats.failed.push(`${label}: ${String(e.message).slice(0, 160)}`); } };
process.on("exit", () => { if (stats.failed.length) { process.exitCode = 1; console.error(`Error: ${stats.failed.length}/${stats.total} failed; first: ${stats.failed[0]}`); } if (process.env.HIDDEN_GRADED) console.log(`SCORE ${JSON.stringify({ total: stats.total, failed: stats.failed.length, samples: stats.failed.slice(0, 5) })}`); });
let seed = 777; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const words = ["alpha", "beta", "gamma", "delta", "eps", "zeta", "eta", "theta", "iota", "kappa"];
const gen = (n) => Array.from({ length: n }, () => words[rnd(words.length)]);
const lines = (xs) => (xs.length ? xs.join("\n") + "\n" : "");
const cases = [["", "x\ny\n"], ["x\ny\n", ""], ["same\n", "same\n"], ["a\n", "b\n"], ["1\n2\n3\n", "1\n2\n3\n4\n"], ["0\n1\n2\n3\n", "1\n2\n3\n"]];
for (let i = 0; i < 40; i++) {
	const a = gen(rnd(60)); const b = a.slice();
	for (let k = rnd(8); k > 0; k--) { const op = rnd(3); const at = rnd(b.length + 1); if (op === 0) b.splice(at, 0, ...gen(1 + rnd(3))); else if (op === 1) b.splice(at, 1 + rnd(3)); else if (b.length) b[at % b.length] = words[rnd(10)] + "!"; }
	cases.push([lines(a), lines(b)]);
}
const dir = mkdtempSync(join(tmpdir(), "diffcase-"));
const count = (text) => text.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).length;
cases.forEach(([a, b], idx) => attempt(`case ${idx}`, () => {
	const out = unifiedDiff(a, b, { context: 3, nameA: "a.txt", nameB: "b.txt" });
	const fa = join(dir, "a.txt"); const fb = join(dir, "b.txt"); const patchFile = join(dir, "p.patch");
	writeFileSync(fa, a); writeFileSync(fb, b);
	if (a === b) { if (out !== "") fail(`case ${idx}: identical inputs must give ""`); return; }
	if (!out.startsWith("--- a.txt\n+++ b.txt\n@@ ")) fail(`case ${idx}: bad header: ${JSON.stringify(out.slice(0, 60))}`);
	if (!out.endsWith("\n")) fail(`case ${idx}: must end with newline`);
	const real = spawnSync("diff", ["-u", "a.txt", "b.txt"], { cwd: dir, encoding: "utf8" }).stdout;
	if (count(out) !== count(real)) fail(`case ${idx}: ${count(out)} changed lines, diff -u has ${count(real)} (not minimal)`);
	writeFileSync(patchFile, out);
	const res = spawnSync("patch", ["--quiet", "--no-backup-if-mismatch", fa, patchFile], { cwd: dir, encoding: "utf8" });
	if (res.status !== 0) fail(`case ${idx}: patch failed: ${res.stdout}${res.stderr}`);
	if (readFileSync(fa, "utf8") !== b) fail(`case ${idx}: patch did not produce b`);
}));
