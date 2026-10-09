// A/B of the fixed token cost: the same prompt with every extension of two package roots (before / after).
// node eval/guards/tokens.mjs <rootA> <rootB> [runs]   (PI_CODING_AGENT_DIR without packages; never --bare)
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [rootA, rootB, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const project = mkdtempSync(join(tmpdir(), "guards-tokens-"));
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "demo-shop", version: "1.2.3" }));
spawnSync("git", ["init", "-q"], { cwd: project });
const prompt = "Leggi package.json con il tool read e rispondi solo con nome e versione.";

function once(root) {
	const extensions = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pi.extensions.flatMap((path) => ["-e", join(root, path)]);
	const out = spawnSync("pi", ["--no-session", "-ne", "--mode", "json", ...extensions, "-p", prompt], { cwd: project, encoding: "utf8", input: "", timeout: 240_000 });
	const requests = [];
	let answer = "";
	for (const line of out.stdout.split("\n")) {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			const usage = event.message.usage ?? {};
			requests.push((usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0));
			answer = (event.message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("") || answer;
		}
	}
	return { first: requests[0], total: requests.reduce((a, b) => a + b, 0), requests: requests.length, answer: answer.trim().slice(0, 60) };
}

const results = { A: [], B: [] };
for (let run = 0; run < runs; run++) {
	for (const [label, root] of run % 2 ? [["B", rootB], ["A", rootA]] : [["A", rootA], ["B", rootB]]) {
		const result = once(root);
		results[label].push(result);
		console.log(label, JSON.stringify(result));
	}
}
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const label of ["A", "B"]) console.log(`${label}: prima richiesta mediana ${median(results[label].map((r) => r.first))} token · totale mediano ${median(results[label].map((r) => r.total))}`);
