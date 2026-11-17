// A/B: the same task with and without the skill the router picks (appended to the system prompt).
// Run: node eval/skills-router/ab.mjs [--reps 2] [--model sonnet]   Output: eval/skills-router/ab.jsonl
import { execFileSync, execSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cases } from "../cases.mjs";
import { loadRouter, route } from "../../extensions/skills-router.ts";
import { skillBody } from "../../extensions/skills.ts";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const reps = Number(arg("reps", 2)), model = arg("model", "sonnet"), parallel = Number(arg("parallel", 4));
const ids = ["bf01", "bf02", "bf05", "bf06", "ft06", "ft08", "qa03", "qa08"];
const root = join(import.meta.dirname, "..", "..", "skills");
const router = loadRouter(root);
const out = join(import.meta.dirname, "ab.jsonl");
const work = join(tmpdir(), "skills-ab");
mkdirSync(work, { recursive: true });

const tools = "Read,Edit,Write,Glob,Grep,Bash(npm:*),Bash(node:*),Bash(git:*),Bash(ls:*),Bash(cat:*),Bash(grep:*),Bash(wc:*),Bash(head:*),Bash(tail:*),Bash(sort:*),Bash(uniq:*),Bash(sed:*),Bash(awk:*),Bash(cut:*),Bash(find:*),Bash(diff:*)";

function runClaude(cwd, prompt, system) {
	return new Promise((resolve) => {
		const args = ["-p", prompt, "--output-format", "json", "--model", model, "--no-session-persistence", "--permission-mode", "acceptEdits", "--allowedTools", tools, ...(system ? ["--append-system-prompt", system] : [])];
		const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";
		child.stdout.on("data", (d) => (buf += d));
		const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
		child.on("close", () => { clearTimeout(timer); try { resolve(JSON.parse(buf)); } catch { resolve({ error: buf.slice(-200) }); } });
	});
}

async function job({ id, arm, rep }) {
	const c = cases.find((x) => x.id === id);
	const dir = join(work, `${id}-${arm}-${rep}`);
	rmSync(dir, { recursive: true, force: true });
	execSync(`node ${JSON.stringify(join(import.meta.dirname, "..", "fixture/build.mjs"))} ${JSON.stringify(dir)}`);
	const picked = arm === "skill" ? route(router, { message: c.turns[0] }).filter((a) => a.tier === "auto") : [];
	const system = picked.length ? picked.map((a) => skillBody(root, a.skill)).join("\n\n") : undefined;
	const started = Date.now();
	const res = await runClaude(dir, c.turns[0], system);
	const sh = (command) => { try { return { code: 0, out: execSync(command, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }) }; } catch (e) { return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; } };
	const js = (code) => sh(`node --input-type=module -e ${JSON.stringify(code)}`).out.trim();
	let verdict;
	try { verdict = c.check({ dir, turns: [], answer: res.result ?? "", sh, js }); } catch (e) { verdict = { pass: false, detail: String(e) }; }
	const u = res.usage ?? {};
	const row = { id, arm, rep, skills: picked.map((a) => a.skill.split("/").pop()), pass: verdict.pass, detail: String(verdict.detail).slice(0, 120), turns: res.num_turns, cost: res.total_cost_usd, outTokens: u.output_tokens, inTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), sec: Math.round((Date.now() - started) / 100) / 10, answerChars: (res.result ?? "").length, error: res.error };
	appendFileSync(out, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row));
}

writeFileSync(out, "");
const jobs = [];
for (let rep = 1; rep <= reps; rep++) for (const id of ids) for (const arm of ["base", "skill"]) jobs.push({ id, arm, rep });
let next = 0;
await Promise.all(Array.from({ length: parallel }, async () => { while (next < jobs.length) await job(jobs[next++]); }));
