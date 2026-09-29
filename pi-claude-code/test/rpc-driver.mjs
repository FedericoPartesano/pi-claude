#!/usr/bin/env node
// Drives `pi --mode rpc` with the pi-claude-code extension through a list of steps and
// prints, per step, the tool calls and final assistant text. Usage:
//   node rpc-driver.mjs [--model sonnet] step1 step2 ...
// A step is a prompt, or one of these directives:
//   /compact                      compact the session
//   !abort:<ms>:<prompt>          send prompt, abort after <ms>
//   !steer:<ms>:<steer>|<prompt>  send prompt, send a steering message after <ms>
//   !fork:<n>                     fork from the n-th user message (0-based) of the active branch
//   !stats                        print session stats (tokens, cost)
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
let model = "sonnet";
if (argv[0] === "--model") {
	model = argv[1];
	argv.splice(0, 2);
}
// Extra extensions to load next to pi-claude-code: --ext <path> (repeatable).
const extraExtensionArgs = [];
while (argv[0] === "--ext") {
	extraExtensionArgs.push("-e", argv[1]);
	argv.splice(0, 2);
}
const steps = argv;

const pi = spawn(
	join(packageDirectory, "node_modules/.bin/pi"),
	["--mode", "rpc", "--no-session", "-e", packageDirectory, ...extraExtensionArgs, "--provider", "claude-code", "--model", model],
	{ stdio: ["pipe", "pipe", "inherit"] },
);

let settle;
let turnToolCalls = [];
let turnText = "";
let turnErrors = [];
let turnAssistantMessages = 0;
const pendingResponses = new Map();
const send = (command) => pi.stdin.write(`${JSON.stringify(command)}\n`);
const request = (command) =>
	new Promise((resolve) => {
		pendingResponses.set(command.type, resolve);
		send(command);
	});

createInterface({ input: pi.stdout }).on("line", (line) => {
	let record;
	try {
		record = JSON.parse(line);
	} catch {
		return;
	}
	if (record.type === "tool_execution_start") turnToolCalls.push(`${record.toolName} ${JSON.stringify(record.args).slice(0, 120)}`);
	if (record.type === "message_end" && record.message?.role === "assistant") {
		turnAssistantMessages++;
		const text = record.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
		if (text) turnText = text;
		if (record.message.errorMessage) turnErrors.push(`[${record.message.stopReason}] ${record.message.errorMessage}`);
	}
	if (record.type === "response") {
		if (record.success === false) turnErrors.push(record.error);
		const resolve = pendingResponses.get(record.command);
		if (resolve) {
			pendingResponses.delete(record.command);
			resolve(record);
		}
	}
	if (record.type === "agent_settled") settle?.();
});

const started = Date.now();
for (const [index, step] of steps.entries()) {
	turnToolCalls = [];
	turnText = "";
	turnErrors = [];
	turnAssistantMessages = 0;
	const turnStarted = Date.now();
	const elapsed = () => `${((Date.now() - turnStarted) / 1000).toFixed(1)}s`;

	if (step === "/compact") {
		const response = await request({ type: "compact" });
		console.log(`\n### compact (${elapsed()}): success=${response.success} ${response.error ?? ""}`);
		console.log(`  tokensBefore=${response.data?.tokensBefore} estimatedAfter=${response.data?.estimatedTokensAfter}`);
		console.log(`  summary: ${(response.data?.summary ?? "").slice(0, 300).replace(/\n/g, " ")}`);
		continue;
	}
	const thinkingMatch = /^!thinking:(\w+)$/.exec(step);
	if (thinkingMatch) {
		const response = await request({ type: "set_thinking_level", level: thinkingMatch[1] });
		console.log(`\n### thinking ${thinkingMatch[1]}: success=${response.success} ${response.error ?? ""}`);
		continue;
	}
	const modelMatch = /^!model:(\w+)$/.exec(step);
	if (modelMatch) {
		const response = await request({ type: "set_model", provider: "claude-code", modelId: modelMatch[1] });
		console.log(`\n### model ${modelMatch[1]}: success=${response.success} ${response.error ?? ""}`);
		continue;
	}
	if (step === "!stats") {
		const response = await request({ type: "get_session_stats" });
		console.log(`\n### stats: ${JSON.stringify(response.data)}`);
		continue;
	}
	const forkMatch = /^!fork:(\d+)$/.exec(step);
	if (forkMatch) {
		const forkMessages = await request({ type: "get_fork_messages" });
		const target = forkMessages.data.messages[Number(forkMatch[1])];
		const response = await request({ type: "fork", entryId: target.entryId });
		console.log(`\n### fork from "${target.text.slice(0, 80)}": success=${response.success} ${response.error ?? ""}`);
		continue;
	}

	let promptText = step;
	let timer;
	const abortMatch = /^!abort:(\d+):(.*)$/s.exec(step);
	const steerMatch = /^!steer:(\d+):(.*?)\|(.*)$/s.exec(step);
	if (abortMatch) {
		promptText = abortMatch[2];
		timer = setTimeout(() => send({ type: "abort" }), Number(abortMatch[1]));
	} else if (steerMatch) {
		promptText = steerMatch[3];
		timer = setTimeout(() => send({ type: "steer", message: steerMatch[2] }), Number(steerMatch[1]));
	}
	const settled = new Promise((resolve) => (settle = resolve));
	send({ id: `p${index}`, type: "prompt", message: promptText });
	await settled;
	clearTimeout(timer);

	console.log(`\n### step ${index + 1} (${elapsed()}, ${turnAssistantMessages} assistant msgs): ${step}`);
	for (const call of turnToolCalls) console.log(`  tool: ${call}`);
	for (const error of turnErrors) console.log(`  ERROR: ${error}`);
	console.log(`  answer: ${turnText.replace(/\n/g, "\n          ")}`);
}
console.log(`\ntotal ${((Date.now() - started) / 1000).toFixed(1)}s`);
pi.stdin.end();
pi.kill("SIGTERM");
