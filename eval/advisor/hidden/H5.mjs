import { match } from "./regex.js";
const fail = (m) => { throw new Error(m); };
const stats = { total: 0, failed: [] };
const attempt = (label, fn) => { stats.total++; try { fn(); } catch (e) { stats.failed.push(`${label}: ${String(e.message).slice(0, 160)}`); } };
process.on("exit", () => { if (process.env.HIDDEN_GRADED) console.log(`SCORE ${JSON.stringify({ total: stats.total, failed: stats.failed.length, samples: stats.failed.slice(0, 5) })}`); if (stats.failed.length) { process.exitCode = 1; console.error(`Error: ${stats.failed.length}/${stats.total} failed; first: ${stats.failed[0]}`); } });
const fixed = [["a|ab", "ab"], ["(a|ab)(c|bcd)", "abcd"], ["a*?b", "aaab"], ["a+?", "aaa"], ["(a+)+b", "aaab"], ["(a*)*", "b"], ["(a*)+", "b"], ["(z)((a+)?(b+)?(c))*", "zaacbbbcac"], ["(a)|b", "b"], ["(?:a|b)+c", "abbac"], ["(a)\\1", "aa"], ["(a)?\\1b", "b"], ["\\1(a)", "aa"], ["(?:(a)|b)*", "ab"], ["a{2,3}", "aaaa"], ["a{2,3}?", "aaaa"], ["a{0}", "a"], ["x{2,}", "xxxxx"], [".*", "ab\ncd"], ["[^a-c]+", "xyzabc"], ["[a-c-e]+", "ab-e"], ["\\d+\\.\\d*", "12.5"], ["\\w+\\s\\W", "ab c!"], ["^$", ""], ["a$", "a"], ["^a", "ba"], ["(a|b)*?c", "abc"], ["((a)|(b))+", "ab"], ["(?:)", ""], ["a||b", "b"]];
const alphabet = ["a", "b", "c"];
let seed = 4242; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
const atom = (depth) => { const r = rnd(10); if (r < 4) return alphabet[rnd(3)]; if (r === 4) return "."; if (r === 5) return ["[ab]", "[^a]", "\\w", "\\d"][rnd(4)]; if (depth > 2) return alphabet[rnd(3)]; if (r === 6) return `(${alt(depth + 1)})`; if (r === 7) return `(?:${alt(depth + 1)})`; if (r === 8) return `(${alt(depth + 1)})`; return alphabet[rnd(3)]; };
const piece = (depth) => { let a = atom(depth); const r = rnd(8); if (r === 0) a += "*"; else if (r === 1) a += "+"; else if (r === 2) a += "?"; else if (r === 3) a += "*?"; else if (r === 4) a += "{1,2}"; else if (r === 5) a += "+?"; return a; };
const seq = (depth) => Array.from({ length: 1 + rnd(3) }, () => piece(depth)).join("");
const alt = (depth) => Array.from({ length: 1 + rnd(2) }, () => seq(depth)).join("|");
const cases = fixed.map(([p, s]) => [p, s]);
for (let i = 0; i < 400; i++) { let p = alt(0); if (rnd(6) === 0) p = "^" + p; if (rnd(6) === 0) p += "$"; const s = Array.from({ length: rnd(7) }, () => alphabet[rnd(3)]).join(""); cases.push([p, s]); }
const norm = (m) => m === null || m === undefined ? null : { index: m.index, groups: Array.from(m, (g) => (g === undefined ? null : g)) };
for (const [p, s] of cases) attempt(`/${p}/ on ${JSON.stringify(s)}`, () => {
	let want; try { want = norm(new RegExp(p).exec(s)); } catch { return; }
	const got = norm(match(p, s));
	if (JSON.stringify(got) !== JSON.stringify(want)) fail(`/${p}/ on ${JSON.stringify(s)}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
});
for (const bad of ["(a", "a)", "*a", "a**", "[a", "a{2,1}", "\\"]) attempt(`syntax ${bad}`, () => { try { match(bad, "a"); } catch (e) { if (e instanceof SyntaxError) return; fail(`threw ${e?.constructor?.name}`); } fail("no throw"); });
