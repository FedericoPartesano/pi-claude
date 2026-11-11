import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBashToolDefinition, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { backgroundBash, backgroundTasks, detachAll, outcomeOf, runningCount, taskRows, watchBackgroundTasks, type Done } from "../src/bg-bash.ts";

const setup = () => {
	const dir = mkdtempSync(join(tmpdir(), "bgb-"));
	const done: Done[] = [];
	let wake: () => void = () => {};
	const ended = new Promise<void>((r) => (wake = r));
	const tool = backgroundBash((ops) => createBashToolDefinition(process.cwd(), { operations: ops as never }) as never, createLocalBashOperations() as never, (d) => { done.push(d); wake(); }, dir);
	return { tool, done, ended };
};

test("bash normale: stesso risultato del bash di Pi", async () => {
	const { tool } = setup();
	const r = await tool.execute("c1", { command: "echo ciao" }, undefined, undefined);
	assert.equal(r.content[0].text.trim(), "ciao");
	assert.equal(runningCount(), 0);
	const e = (await tool.execute("c2", { command: "exit 3" }, undefined, undefined).catch((err: Error) => ({ content: [{ text: err.message }] }))) as { content: { text: string }[] };
	assert.match(e.content[0].text, /code 3/);
});

test("detachAll: il tool ritorna subito, il comando continua e alla fine arriva il messaggio", async () => {
	const { tool, done, ended } = setup();
	const t0 = Date.now();
	const p = tool.execute("c3", { command: "echo prima; sleep 1; echo dopo; exit 2" }, undefined, undefined);
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(detachAll(), 1);
	const r = await p;
	assert.ok(Date.now() - t0 < 900, "returns before the command ends");
	assert.match(r.content[0].text, /prima/);
	assert.match(r.content[0].text, /background/);
	assert.equal(done.length, 0);
	await ended;
	assert.equal(done[0].outcome, "exit 2");
	assert.match(done[0].tail, /dopo/);
	assert.ok(existsSync(done[0].log));
	assert.match(readFileSync(done[0].log, "utf8"), /prima[\s\S]*dopo/);
});

test("dopo il distacco l'abort del turno non uccide il comando", async () => {
	const { tool, done, ended } = setup();
	const ac = new AbortController();
	const p = tool.execute("c4", { command: "sleep 0.6; echo vivo" }, ac.signal, undefined);
	await new Promise((r) => setTimeout(r, 100));
	detachAll();
	await p;
	ac.abort();
	await ended;
	assert.equal(done[0].outcome, "exit 0");
	assert.match(done[0].tail, /vivo/);
});

test("abort prima del distacco uccide il comando come il bash di Pi", async () => {
	const { tool } = setup();
	const ac = new AbortController();
	const p = tool.execute("c5", { command: "sleep 5" }, ac.signal, undefined);
	setTimeout(() => ac.abort(), 100);
	await assert.rejects(p, /aborted/);
});

test("outcomeOf", () => {
	assert.equal(outcomeOf(undefined), "exit 0");
	assert.equal(outcomeOf(new Error("out\n\nCommand exited with code 7")), "exit 7");
	assert.equal(outcomeOf(new Error("x\n\nCommand timed out after 5 seconds")), "timed out after 5 seconds");
});

test("task in background: elenco e avvisi all'avvio e alla fine, righe compatte", async () => {
	const { tool, ended } = setup();
	let changes = 0;
	watchBackgroundTasks(() => changes++);
	const p = tool.execute("c9", { command: "sleep 0.5" }, undefined, undefined);
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(backgroundTasks().length, 0, "non staccato: non è un task in background");
	detachAll();
	await p;
	assert.equal(backgroundTasks().length, 1);
	assert.equal(changes, 1);
	assert.match(taskRows(backgroundTasks())[0], /^\d\d:\d\d:\d\d {2}sleep 0\.5$/);
	await ended;
	assert.equal(backgroundTasks().length, 0);
	assert.equal(changes, 2);
	watchBackgroundTasks(undefined);
	const many = Array.from({ length: 5 }, (_, i) => ({ command: `c${i}`, startedAt: 0, log: "" }));
	assert.equal(taskRows(many).length, 4);
	assert.equal(taskRows(many)[3], "+2 altri");
});
