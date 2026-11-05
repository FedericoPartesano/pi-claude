import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jobs, { doneMessage, logTail } from "./jobs.ts";

const harness = () => {
	const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
	let active = ["read"];
	const tools: Record<string, { execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> }> = {};
	const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
	const sent: { message: { content: string; customType: string }; options: Record<string, unknown> }[] = [];
	const bus: { name: string; data: any }[] = [];
	const notes: string[] = [];
	jobs({
		on: (name: string, handler: never) => void (handlers[name] = handler),
		registerTool: (tool: { name: string }) => void (tools[tool.name] = tool as never),
		registerCommand: (name: string, command: never) => void (commands[name] = command),
		getActiveTools: () => active,
		setActiveTools: (next: string[]) => void (active = next),
		sendMessage: (message: never, options: never) => void sent.push({ message, options }),
		events: { emit: (name: string, data: unknown) => void bus.push({ name, data }), on() {} },
	} as never);
	const ctx = { cwd: tmpdir(), ui: { notify: (text: string) => void notes.push(text) } };
	return { handlers, tools, commands, sent, bus, notes, ctx, active: () => active };
};

test("logTail keeps the last lines and strips colours", () => {
	const file = join(mkdtempSync(join(tmpdir(), "jobs-")), "a.log");
	writeFileSync(file, Array.from({ length: 50 }, (_, i) => `\x1b[32mline ${i}\x1b[0m`).join("\n"));
	const tail = logTail(file, 1500, 3);
	assert.equal(tail, "line 47\nline 48\nline 49");
	assert.equal(logTail(join(tmpdir(), "nope-jobs.log")), "");
});

test("doneMessage reports exit, signal and timeout", () => {
	const file = join(mkdtempSync(join(tmpdir(), "jobs-")), "a.log");
	writeFileSync(file, "ok\n");
	const job = { id: "j1", name: "tests", log: file };
	assert.match(doneMessage(job, 0, null, 12_400, false), /exit 0, 12s[\s\S]*Last lines:\nok/);
	assert.match(doneMessage(job, null, "SIGTERM", 1000, false), /stopped by SIGTERM/);
	assert.match(doneMessage(job, null, "SIGTERM", 5000, true), /killed after the 5s timeout/);
});

test("the tool is off until /jobs on; a job ends and wakes the model with its tail", async () => {
	delete process.env.PI_JOBS;
	const h = harness();
	h.handlers.session_start({}, h.ctx);
	assert.deepEqual([Object.keys(h.tools), h.active()], [[], ["read"]]);
	await h.commands.jobs.handler("on", h.ctx);
	assert.deepEqual([Object.keys(h.tools), h.active()], [["lancia"], ["read", "lancia"]]);

	const result = await h.tools.lancia.execute("id", { command: "echo ciao; echo errore >&2; exit 3", name: "demo" }, undefined, undefined, h.ctx);
	assert.match(result.content[0].text, /Started j1 «demo»/);
	assert.equal(h.bus[0].name, "timeout-bar:set");
	assert.equal(h.bus[0].data.key, "job:j1");
	for (let i = 0; i < 100 && !h.sent.length; i++) await new Promise((r) => setTimeout(r, 50));
	assert.equal(h.sent.length, 1);
	assert.match(h.sent[0].message.content, /Job j1 «demo» finished: exit 3/);
	assert.match(h.sent[0].message.content, /ciao\nerrore/);
	assert.deepEqual(h.sent[0].options, { triggerTurn: true, deliverAs: "followUp" });
	assert.ok(h.bus.some((event) => event.name === "timeout-bar:clear" && event.data.key === "job:j1"));
	await h.commands.jobs.handler("", h.ctx);
	assert.match(h.notes.at(-1)!, /Nessun job in corso/);
});

test("timeout kills the whole job and /jobs kill stops one", async () => {
	const h = harness();
	await h.commands.jobs.handler("on", h.ctx);
	await h.tools.lancia.execute("id", { command: "sleep 30", timeout: 0.3 }, undefined, undefined, h.ctx);
	await h.tools.lancia.execute("id", { command: "sleep 30; echo x" }, undefined, undefined, h.ctx);
	await h.commands.jobs.handler("", h.ctx);
	assert.match(h.notes.at(-1)!, /j1 .*\nj2 /);
	await h.commands.jobs.handler("kill j2", h.ctx);
	for (let i = 0; i < 100 && h.sent.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
	const texts = h.sent.map((entry) => entry.message.content);
	assert.ok(texts.some((text) => /Job j1 .* killed after the 0s timeout/.test(text)), texts.join("|"));
	assert.ok(texts.some((text) => /Job j2 .* stopped by SIGTERM/.test(text)), texts.join("|"));
	h.handlers.session_shutdown({}, h.ctx);
});

test("PI_JOBS=1 turns the tool on at session start", () => {
	process.env.PI_JOBS = "1";
	const h = harness();
	h.handlers.session_start({}, h.ctx);
	assert.deepEqual(h.active(), ["read", "lancia"]);
	delete process.env.PI_JOBS;
});
