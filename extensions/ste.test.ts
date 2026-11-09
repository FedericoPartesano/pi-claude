import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ste, { MARKER, RULES } from "./ste.ts";
import { MARKER as CAVEMAN_MARKER, RULES as CAVEMAN_RULES } from "./caveman.ts";

const dir = mkdtempSync(join(tmpdir(), "ste-"));
process.env.PI_CODING_AGENT_DIR = dir;
const load = () => {
	const handlers: Record<string, any> = {}; let command: any;
	ste({ on: (name: string, h: any) => (handlers[name] = h), registerCommand: (_: string, c: any) => (command = c) } as any);
	return { ...handlers, command } as Record<string, any>;
};
const withEnv = (value: string | undefined, fn: () => void) => {
	const before = process.env.PI_STE;
	if (value === undefined) delete process.env.PI_STE; else process.env.PI_STE = value;
	try { fn(); } finally { if (before === undefined) delete process.env.PI_STE; else process.env.PI_STE = before; }
};
const ctxWith = (log: string[]) => ({ hasUI: true, ui: { setStatus: (_k: string, v: string | undefined) => log.push(`status:${v}`), notify: (m: string) => log.push(`notify:${m}`) } });

test("short, stable text in English", () => {
	assert.ok(RULES.length < 450, String(RULES.length));
	assert.ok(RULES.startsWith(MARKER));
	for (const word of ["ASD-STE100", "20 words", "25", "Active voice", "-ing", "articles", "vertical lists", "exact"]) assert.ok(RULES.includes(word), word);
});
test("off by default: adds nothing", () => withEnv(undefined, () => {
	assert.equal(load().before_agent_start({ systemPrompt: "base" }), undefined);
	const log: string[] = []; load().session_start({}, ctxWith(log));
	assert.deepEqual(log, ["status:undefined"]);
}));
test("PI_STE=1 appends the rules once", () => withEnv("1", () => {
	const h = load().before_agent_start;
	const out = h({ systemPrompt: "base" });
	assert.equal(out.systemPrompt, `base\n\n${RULES}`);
	assert.equal(h({ systemPrompt: out.systemPrompt }), undefined);
}));
test("STE replaces the caveman block", () => withEnv("1", () => {
	const out = load().before_agent_start({ systemPrompt: `base\n\n${CAVEMAN_RULES}` });
	assert.equal(out.systemPrompt, `base\n\n${RULES}`);
	assert.ok(!out.systemPrompt.includes(CAVEMAN_MARKER));
}));
test("/ste on|off toggles, saves, updates the badge", () => withEnv(undefined, () => {
	const h = load(); const log: string[] = []; const ctx = ctxWith(log);
	h.command.handler("on", ctx);
	assert.equal(h.before_agent_start({ systemPrompt: "b" }).systemPrompt, `b\n\n${RULES}`);
	assert.equal(readFileSync(join(dir, "ste-mode"), "utf8"), "on");
	assert.equal(load().before_agent_start({ systemPrompt: "b" }).systemPrompt, `b\n\n${RULES}`); // remembered
	h.command.handler("off", ctx);
	assert.equal(h.before_agent_start({ systemPrompt: "b" }), undefined);
	assert.deepEqual(log.filter((l) => l.startsWith("status:")), ["status:on", "status:undefined"]);
}));
test("/ste status and bad argument", () => withEnv("1", () => {
	const h = load(); const log: string[] = [];
	h.command.handler("status", ctxWith(log));
	h.command.handler("zzz", ctxWith(log));
	assert.ok(log[0].startsWith("notify:STE: on."));
	assert.ok(log[1].includes("Use: /ste"));
}));
