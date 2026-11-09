#!/usr/bin/env node
// Run only the tests touched by the working tree: `node scripts/t.mjs [--watch] [name...]`.
// With no names: changed files (git) → their *.test.ts / *.test.mjs; a name matches extensions/<name>.test.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const args = process.argv.slice(2);
const watch = args.includes("--watch");
const names = args.filter((a) => !a.startsWith("--"));
const changed = names.length ? [] : execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ""));
const guess = (f) => [f.replace(/\.(ts|mjs)$/, ".test.$1"), f.replace(/\.(ts|mjs)$/, ".test.ts"), f.replace(/\.(ts|mjs)$/, ".test.mjs"), f.replace(/^(extensions\/[^/]+)\/.*/, "$1.test.ts")];
const tests = new Set(names.map((n) => `extensions/${n}.test.ts`).filter(existsSync));
for (const f of changed) { if (/\.test\.(ts|mjs)$/.test(f) && existsSync(f)) tests.add(f); else for (const g of guess(f)) if (g !== f && existsSync(g)) tests.add(g); }
if (!tests.size) { console.log("nessun test da lanciare"); process.exit(0); }
console.log([...tests].join("\n"));
const env = { ...process.env, PI_ARCHIVE_SEM: process.env.PI_ARCHIVE_SEM ?? "0" };
process.exit(spawnSync("node", ["--test", "--test-concurrency=2", ...(watch ? ["--watch"] : []), ...tests], { stdio: "inherit", env }).status ?? 1);
