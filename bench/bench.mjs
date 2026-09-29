#!/usr/bin/env node
// Benchmark: same task through Claude Code native and Pi (claude-code bridge).
// Usage: node bench.mjs <runs> <scenario>   scenario: simple | code | delegate
// Prints one JSON line per run: harness, seconds, model requests, input/output tokens, answer.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const runs = Number(process.argv[2] ?? 3);
const scenario = process.argv[3] ?? "simple";
const workDirectory = process.env.BENCH_CWD ?? "/tmp/pitest";

const prompts = {
	simple: "Leggi il file /tmp/pitest/secret.txt e dimmi solo il contenuto.",
	code:
		"Nel progetto ~/documents/projects/pi-claude/pi-claude-code trova in quale file e riga viene impostata la variabile MCP_TOOL_TIMEOUT e che valore ha. Rispondi in una riga: file:riga valore.",
	delegate:
		"Delega a un sub-agente (usa il tuo strumento per sub-agenti) questo compito: nel progetto ~/documents/projects/pi-claude/pi-claude-code trova in quale file e riga viene impostata la variabile MCP_TOOL_TIMEOUT e che valore ha. Poi riportami la risposta del sub-agente in una riga: file:riga valore.",
};

const harnesses = {
	// Claude Code as the user runs it (their settings, hooks, plugins, CLAUDE.md, MCP servers).
	"claude-code": {
		command: "claude",
		// Read-only tasks: Read/Grep/Glob and subagents need no permission prompt in print mode.
		args: (prompt) => [
			"-p", prompt, "--output-format", "stream-json", "--verbose",
			// Claude Code limits file access to the working directory; Pi does not.
			"--add-dir", `${process.env.HOME}/documents/projects/pi-claude`,
		],
	},
	// Pi with the claude-code provider; `pi-full` has the subagent extension.
	pi: {
		command: scenario === "delegate" ? "pi-full" : "pi",
		args: (prompt) => ["--mode", "json", "--no-session", prompt],
	},
};

function runOnce(name, harness, prompt) {
	return new Promise((resolve) => {
		const started = Date.now();
		const child = spawn(harness.command, harness.args(prompt), { cwd: workDirectory, stdio: ["ignore", "pipe", "ignore"] });
		const totals = { requests: 0, input: 0, output: 0 };
		const seenMessageIds = new Set();
		let answer = "";
		createInterface({ input: child.stdout }).on("line", (line) => {
			let record;
			try {
				record = JSON.parse(line);
			} catch {
				return;
			}
			if (name === "claude-code") {
				// One assistant record per content block: count each API message once. Subagent
				// messages carry parent_tool_use_id and are included (they are real usage).
				if (record.type === "assistant" && record.message?.usage && !seenMessageIds.has(record.message.id)) {
					seenMessageIds.add(record.message.id);
					const usage = record.message.usage;
					totals.requests++;
					totals.input += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
					totals.output += usage.output_tokens;
				}
				if (record.type === "result") answer = record.result ?? "";
			} else {
				if (record.type === "message_end" && record.message?.role === "assistant") {
					const usage = record.message.usage;
					totals.requests++;
					totals.input += usage.input + usage.cacheRead + usage.cacheWrite;
					totals.output += usage.output;
					const text = record.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
					if (text) answer = text;
				}
				// Subagent usage is reported inside the subagent tool result details.
				if (record.type === "tool_execution_end" && record.toolName === "subagent") {
					for (const result of record.result?.details?.results ?? []) {
						totals.subagentInput = (totals.subagentInput ?? 0) + (result.usage?.input ?? 0) + (result.usage?.cacheRead ?? 0) + (result.usage?.cacheWrite ?? 0);
						totals.subagentOutput = (totals.subagentOutput ?? 0) + (result.usage?.output ?? 0);
						totals.subagentRequests = (totals.subagentRequests ?? 0) + (result.usage?.turns ?? 0);
					}
				}
			}
		});
		child.on("close", () =>
			resolve({
				harness: name,
				seconds: Math.round((Date.now() - started) / 100) / 10,
				...totals,
				answer: answer.replace(/\s+/g, " ").slice(0, 90),
			}),
		);
	});
}

for (let run = 1; run <= runs; run++) {
	for (const [name, harness] of Object.entries(harnesses)) {
		console.log(JSON.stringify({ scenario, run, ...(await runOnce(name, harness, prompts[scenario])) }));
	}
}
