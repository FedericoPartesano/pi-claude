import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compare, satisfies } from "./semver.js";
const oracle = createRequire(import.meta.url)(process.env.SEMVER_ORACLE);
const fail = (m) => { throw new Error(m); };
const stats = { total: 0, failed: [] };
process.on("exit", () => { if (process.env.HIDDEN_GRADED) console.log(`SCORE ${JSON.stringify({ total: stats.total, failed: stats.failed.length, samples: stats.failed.slice(0, 5) })}`); });
if (/from\s+["']semver|require\(\s*["']semver/.test(readFileSync("semver.js", "utf8"))) fail("semver.js imports semver");
const versions = ["0.0.1", "0.0.3", "0.2.3", "1.0.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.2.3", "1.2.3-beta.2", "1.2.3-beta.4", "1.2.4", "1.3.0", "1.9.9", "2.0.0", "2.0.0-rc.1", "2.3.4", "2.3.5", "3.0.0", "10.0.0", "1.0.0+build.5"];
const ranges = ["1.2.3", "=1.2.3", ">1.2.3", ">=1.2.3", "<1.2.3", "<=1.2.3", "^1.2.3", "^0.2.3", "^0.0.3", "^0.0", "^0", "^1.2", "^1.x", "~1.2.3", "~1.2", "~1", "~0.2.3", "1.x", "1.2.x", "1.2.*", "1", "1.2", "*", "x", "", ">=1.2.3 <2.0.0", ">1.0.0 <=2.0.0", "1.2.3 - 2.3.4", "1.2 - 2", "1.0.0 - 2.x", "<1.0.0 || >=2.0.0", "^1.0.0 || ^3.0.0", ">=1.2.3-beta.1", "^1.2.3-beta.2", "~1.2.3-beta.2", "1.0.0-beta", ">1.0.0-alpha <1.0.0", ">=2.0.0-rc.1 <2.0.0", "<2.0.0", ">=0.0.0", "<=1.x", ">1.2", ">=1.2", "<1.2", "<=1.2", ">1", "<1"];
let bad = 0; const sample = [];
for (const v of versions) for (const r of ranges) { let got; try { got = satisfies(v, r); } catch (e) { got = `threw ${e.message}`; } const want = oracle.satisfies(v, r); if (got !== want) { bad++; if (sample.length < 6) sample.push(`satisfies(${v}, "${r}") = ${got}, want ${want}`); } }
for (const a of versions) for (const b of versions) { let got; try { got = Math.sign(compare(a, b)); } catch (e) { got = `threw ${e.message}`; } const want = oracle.compare(a, b); if (got !== want) { bad++; if (sample.length < 6) sample.push(`compare(${a}, ${b}) = ${got}, want ${want}`); } }
for (const v of ["1", "1.2", "a.b.c", "", "1.2.3.4", "01.2.3"]) { try { compare(v, "1.0.0"); sample.push(`compare(${JSON.stringify(v)}) did not throw`); bad++; } catch (e) { if (!(e instanceof TypeError)) { sample.push(`compare(${JSON.stringify(v)}) threw ${e.constructor.name}`); bad++; } } if (satisfies(v, "*") !== false) { sample.push(`satisfies(${JSON.stringify(v)}, "*") should be false`); bad++; } }
for (const r of ["not a range", ">>1.0.0", "1.2.3 -", "^"]) if (satisfies("1.0.0", r) !== false) { sample.push(`satisfies("1.0.0", ${JSON.stringify(r)}) should be false`); bad++; }
stats.total = versions.length * ranges.length + versions.length ** 2 + 10; stats.failed = Array.from({ length: bad }, (_, i) => sample[i] ?? "mismatch");
if (bad) fail(`${bad} mismatches vs npm semver: ${sample.join("; ")}`);
