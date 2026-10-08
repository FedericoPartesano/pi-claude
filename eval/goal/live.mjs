#!/usr/bin/env node
// Live checks of /goal (extensions/goal.ts) with a real model: does it close only when everything is done and proven,
// pause when something cannot be done, keep the intent's checklist up to date, and tell the user what happens.
// Usage: node eval/goal/live.mjs [--model sonnet] [--only S1,S2]   (each scenario runs pi -p "/goal …" in a temp dir)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const model = argument("model", "sonnet");
const only = argument("only", "").split(",").filter(Boolean);
const intent = (title, outcomes) => `---\nstatus: ready\ncreated: 2026-10-08\nsource: user\n---\n# Intent: ${title}\n\n## Problema\n${title}.\n\n## Outcome atteso\n${outcomes.map((o) => `- [ ] ${o}`).join("\n")}\n\n## Utenti e sistemi impattati\n- nessuno\n\n## Vincoli\n- nessuno\n\n## Domande aperte\n\n## Verifica\n`;
const read = (dir, path) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : "");
const statusOf = (dir, file) => /^status:\s*(\S+)/m.exec(read(dir, file))?.[1];
const ticked = (dir, file) => (read(dir, file).match(/^- \[[xX]\]/gm) ?? []).length;

const SCENARIOS = [
	{ id: "S1", what: "intent fattibile: chiude in done con tutto spuntato",
		setup: (dir) => writeFileSync(join(dir, "intents/i.md"), intent("tre file", ["a.txt contiene alfa", "b.txt contiene beta", "lo script check.sh stampa OK se a.txt e b.txt esistono"])),
		goal: "/goal --max 6 @intents/i.md",
		check: (dir, log) => [
			["intent done", statusOf(dir, "intents/i.md") === "done"],
			["3 risultati spuntati", ticked(dir, "intents/i.md") === 3],
			["file creati", read(dir, "a.txt").includes("alfa") && read(dir, "b.txt").includes("beta")],
			["evento avvio e completamento", /▶ Goal avviato/.test(log) && /✓ Goal completato/.test(log)],
		] },
	{ id: "S2", what: "parte impossibile: pausa, intent ancora in-progress",
		setup: (dir) => writeFileSync(join(dir, "intents/i.md"), intent("file e browser", ["a.txt contiene alfa", "verifica a mano in Chrome che http://localhost:9 mostri la pagina alfa"])),
		goal: "/goal --max 4 @intents/i.md",
		check: (dir, log) => [
			["intent in-progress", statusOf(dir, "intents/i.md") === "in-progress"],
			["non completato", !/✓ Goal completato/.test(log)],
			["pausa o attesa", /⏸ Goal/.test(log)],
			["parte fattibile fatta", read(dir, "a.txt").includes("alfa")],
		] },
	{ id: "S3", what: "trappola: il README non si dimentica",
		setup: (dir) => writeFileSync(join(dir, "intents/i.md"), intent("funzione somma", ["math.js esporta somma(a, b)", "test.js verifica somma con node e passa", "README.md documenta somma con un esempio"])),
		goal: "/goal --max 6 @intents/i.md",
		check: (dir, log) => [
			["README presente", /somma/i.test(read(dir, "README.md"))],
			["test passa", (() => { try { execSync("node test.js", { cwd: dir, stdio: "ignore" }); return true; } catch { return false; } })()],
			["intent done con 3 spunte", statusOf(dir, "intents/i.md") === "done" && ticked(dir, "intents/i.md") === 3],
		] },
	{ id: "S4", what: "goal breve senza intent: done con una prova",
		setup: () => {},
		goal: "/goal scrivi ciao.txt con dentro ciao",
		check: (dir, log) => [
			["file", read(dir, "ciao.txt").includes("ciao")],
			["completato", /✓ Goal completato/.test(log)],
		] },
	{ id: "S5", what: "obiettivo vago: intent scritto come checklist, tutto spuntato",
		setup: () => {},
		goal: "/goal --max 8 prepara un piccolo modulo node slugify.js con una funzione slugify, un test che passa con node e un README che spiega come usarla",
		check: (dir, log) => {
			const file = execSync("ls intents 2>/dev/null || true", { cwd: dir, encoding: "utf8" }).trim().split("\n").filter(Boolean)[0];
			const text = file ? read(dir, `intents/${file}`) : "";
			return [
				["intent creato", Boolean(file)],
				["checklist", /^- \[[ xX]\]/m.test(text)],
				["tutto spuntato e done", file && statusOf(dir, `intents/${file}`) === "done" && !/^- \[ \]/m.test(text)],
				["README e test", existsSync(join(dir, "README.md")) && (() => { try { execSync("ls *.test.js test*.js 2>/dev/null | head -1 | xargs -r node", { cwd: dir, stdio: "ignore" }); return true; } catch { return false; } })()],
			];
		} },
];

function run(scenario) {
	const dir = mkdtempSync(join(tmpdir(), `goal-${scenario.id}-`));
	mkdirSync(join(dir, "intents"));
	execSync("git init -q", { cwd: dir });
	scenario.setup(dir);
	const started = Date.now();
	return new Promise((done) => {
		const child = spawn("pi", ["-p", "--no-session", "--model", model, scenario.goal], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
		let log = "";
		child.stdout.on("data", (chunk) => (log += chunk));
		child.stderr.on("data", (chunk) => (log += chunk));
		const timer = setTimeout(() => child.kill("SIGTERM"), 20 * 60_000);
		child.on("close", () => {
			clearTimeout(timer);
			const checks = scenario.check(dir, log);
			done({ id: scenario.id, what: scenario.what, dir, seconds: Math.round((Date.now() - started) / 1000), checks, events: (log.match(/^[▶↻✗⏸✓■] .*$/gm) ?? []) });
		});
	});
}

const results = await Promise.all(SCENARIOS.filter((s) => !only.length || only.includes(s.id)).map(run));
let failed = 0;
for (const result of results) {
	const ok = result.checks.every(([, pass]) => pass);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${result.id} ${result.what} (${result.seconds}s) ${result.dir}`);
	for (const [name, pass] of result.checks) console.log(`   ${pass ? "✓" : "✗"} ${name}`);
	for (const line of result.events) console.log(`     ${line}`);
}
process.exit(failed ? 1 : 0);
