// Loads the rendering part of chat.mjs (theme → frame) in isolation: no child process, no TTY, no changes to chat.mjs.
// The slice is evaluated with a stub terminal; `api.state` reads/writes the module-level state by name.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "chat.mjs"), "utf8");
const from = source.indexOf("let yolo");
const to = source.indexOf("let timer, lastDraw");
if (from < 0 || to < 0) throw new Error("perf-harness: markers 'let yolo' / 'let timer' not found in chat.mjs");
// Every relative import of chat.mjs (copy, agents, processes, cockpit, usage, test-output…) is loaded here and handed to the slice
// by name, so a new import in chat.mjs cannot break the harness again (it used to list them by hand: codeBlocks, activeRows…).
const imported = {};
for (const m of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/gm)) {
	const mod = await import(new URL(m[2], import.meta.url).href);
	for (const part of m[1].split(",")) {
		const [name, alias = name] = part.trim().split(/\s+as\s+/);
		if (name) imported[alias] = mod[name];
	}
}
const importedNames = Object.keys(imported);
const body = source.slice(from, to).replace(/const out = process\.stdout;/, "");

export const load = ({ columns = 120, rows = 40 } = {}) => {
	const written = [];
	const out = { columns, rows, write: (s) => { written.push(s); return true; }, on() {} };
	const names = ["frame", "bodyLines", "blockLines", "markdown", "streamMarkdown", "toolLine", "diffRows", "sideLines", "wrap", "wrapAnsi", "hardWrap", "cut", "pad", "width_", "chart", "popup", "fuzzy", "blocks", "append", "statuses", "widgets", "git", "cache", "S", "P", "R"];
	const fn = new Function("out", "env", "execFile", "homedir", "readFileSync", "writeFileSync", "readdirSync", "statSync", "dirname", "join", "process", ...importedNames,
		`${body}\nlet __v; return { ${names.join(", ")}, state: new Proxy({}, { get: (_, k) => eval(k), set: (_, k, v) => { __v = v; eval(k + "=__v"); return true; } }) };`);
	const noop = () => undefined;
	const api = fn(out, { ...process.env }, execFile, homedir, noop, noop, noop, noop, dirname, join, process, ...importedNames.map((n) => imported[n]));
	return { ...api, out, written };
};

// Median µs per call over `rounds` rounds of `iters` calls (after a warm-up); the result is kept so V8 cannot drop the call.
let sink;
export const bench = (fn, { iters = 200, rounds = 7 } = {}) => {
	for (let i = 0; i < Math.min(iters, 20); i++) sink = fn();
	const per = [];
	for (let r = 0; r < rounds; r++) {
		const t = process.hrtime.bigint();
		for (let i = 0; i < iters; i++) sink = fn();
		per.push(Number(process.hrtime.bigint() - t) / 1000 / iters);
	}
	per.sort((a, b) => a - b);
	return { us: per[rounds >> 1], min: per[0], max: per[rounds - 1], sink };
};
