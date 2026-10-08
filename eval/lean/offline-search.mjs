#!/usr/bin/env node
// E1 (docs/specs/2026-10-08-lean-tools-design.md): output size of searches the model makes, as grep -rn, rg (Pi's
// grep tool format) and the lean `search` tool, on real repos; and whether the expected file is in each output.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatMatches, parseRgJson, rankFiles } from "../../extensions/lean/search.ts";

const repos = { yaml: join(homedir(), ".cache/pi-eval/repos/yaml"), marked: join(homedir(), ".cache/pi-eval/repos/marked"), pi: join(new URL(".", import.meta.url).pathname, "../..") };
const QUERIES = [
	["yaml", "anchor", "src/doc/anchors.ts"], ["yaml", "resolveFlowCollection", "src/compose/resolve-flow-collection.ts"], ["yaml", "lineWidth", "src/stringify/foldFlowLines.ts"],
	["yaml", "KEY_OVER_1024_CHARS", "src/errors.ts"], ["yaml", "class Lexer", "src/parse/lexer.ts"], ["yaml", "toJS\\(", "src/nodes/toJS.ts"], ["yaml", "sortMapEntries", "src/options.ts"],
	["marked", "walkTokens", "src/Instance.ts"], ["marked", "blockquote", "src/Tokenizer.ts"], ["marked", "escape\\(", "src/Tokenizer.ts"], ["marked", "class _Lexer", "src/Lexer.ts"],
	["marked", "TODO", "test/recheck.ts"], ["marked", "heading", "src/Renderer.ts"], ["marked", "hooks", "src/Instance.ts"],
	["pi", "registerTool", "extensions/tool-groups.ts"], ["pi", "isUsingOverage", "pi-claude-code/src/provider.ts"], ["pi", "parseProposal", "extensions/memory-core.ts"],
	["pi", "renderPanel", "pi-ui/src/panel.ts"], ["pi", "function compactBash", "extensions/lean/bash.ts"], ["pi", "MEMORY_TYPES", "extensions/memory-core.ts"],
];
const run = (cmd, args, cwd) => {
	try {
		return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
	} catch (error) {
		return String(error.stdout ?? "");
	}
};
// Pi's grep tool: path:line: text, 100 matches, lines cut at 500 characters.
const piGrep = (out) => out.split("\n").filter(Boolean).slice(0, 100).map((line) => (line.length > 500 ? line.slice(0, 500) : line)).join("\n");
const tokens = (text) => Math.round(text.length / 3.6);
const rows = [];
for (const [repo, pattern, expect] of QUERIES) {
	const cwd = repos[repo];
	const grep = run("grep", ["-rnE", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=lib", "--exclude-dir=dist", pattern, "."], cwd);
	const rg = piGrep(run("rg", ["-n", "--no-heading", "-e", pattern, "."], cwd));
	const search = formatMatches(parseRgJson(run("rg", ["--json", "--max-columns", "400", "-e", pattern, "."], cwd)).map((m) => ({ ...m, path: m.path.replace(/^\.\//, "") })), {});
	rows.push({ repo, pattern, grep: tokens(grep), rg: tokens(rg), search: tokens(search), found: [grep, rg, search].map((out) => out.includes(expect)) });
}
// File-name searches: find vs search files: true.
const NAMES = [["yaml", "lexer", "src/parse/lexer.ts"], ["marked", "Tokenizer", "src/Tokenizer.ts"], ["pi", "panel", "pi-ui/src/panel.ts"], ["yaml", "anchors", "src/doc/anchors.ts"]];
for (const [repo, name, expect] of NAMES) {
	const cwd = repos[repo];
	const find = run("find", [".", "-iname", `*${name}*`, "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"], cwd);
	const files = rankFiles(run("rg", ["--files"], cwd).split("\n").filter(Boolean), name).slice(0, 50).join("\n");
	rows.push({ repo, pattern: `file:${name}`, grep: tokens(find), rg: tokens(find), search: tokens(files), found: [find.includes(expect), find.includes(expect), files.includes(expect)] });
}
const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
console.log("| repo | ricerca | grep -rn | grep di Pi | search | trovato (grep/Pi/search) |\n|---|---|---|---|---|---|");
for (const row of rows) console.log(`| ${row.repo} | \`${row.pattern}\` | ${row.grep} | ${row.rg} | ${row.search} | ${row.found.map((ok) => (ok ? "✓" : "✗")).join("/")} |`);
console.log(`| **totale** | | **${sum("grep")}** | **${sum("rg")}** | **${sum("search")}** | |`);
console.log(`\nsearch vs grep -rn: ${Math.round((1 - sum("search") / sum("grep")) * 100)}% token in meno; vs grep di Pi: ${Math.round((1 - sum("search") / sum("rg")) * 100)}%`);
