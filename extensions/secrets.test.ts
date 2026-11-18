import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sec-ext-"));
process.env.PI_SECRETS_FILE = join(dir, "s.enc");
process.env.PI_SECRETS_AUDIT = join(dir, "audit.log");
process.env.PI_SECRETS_PASSPHRASE = "mp";
const { Vault } = await import("./secrets/store.ts");
const { default: ext, MARKER } = await import("./secrets.ts");

const handlers: Record<string, (e: any, c: any) => any> = {};
let tool: any;
let active: string[] = [];
ext({ on: (n: string, h: any) => (handlers[n] = h), registerCommand: () => {}, registerTool: (t: any) => (tool = t), getActiveTools: () => active, setActiveTools: (a: string[]) => (active = a) } as any);
const ctx = { hasUI: false, ui: {} } as any;

test("no secrets: prompt untouched, bash passes through", async () => {
	assert.equal(handlers.before_agent_start({ systemPrompt: "base" }, ctx), undefined);
	assert.ok(!active.includes("secret"), "tool stays off without secrets");
	handlers.before_agent_start({ systemPrompt: "base", prompt: "salva il login di github" }, ctx);
	assert.ok(active.includes("secret"), "a credentials request switches it on");
	active = [];
	const input = { command: "ls {{secret:x}}" };
	assert.equal(await handlers.tool_call({ toolName: "bash", toolCallId: "1", input }, ctx), undefined);
});

test("with secrets: one short prompt line with names only, placeholder replaced, result scrubbed", async () => {
	const v = new Vault(process.env.PI_SECRETS_FILE!);
	v.unlock("mp");
	v.set("tok", { kind: "var", value: "VALUE-abc-123", url: "https://api.example.com" });
	const r = handlers.before_agent_start({ systemPrompt: "base" }, ctx);
	assert.ok(r.systemPrompt.includes(`${MARKER}`) && r.systemPrompt.includes("tok") && !r.systemPrompt.includes("VALUE-abc-123"));
	assert.ok(active.includes("secret"), "tool switched on when secrets exist");
	assert.ok(r.systemPrompt.length - 4 < 320, "fixed cost stays small");
	assert.equal(handlers.before_agent_start({ systemPrompt: r.systemPrompt }, ctx), undefined, "idempotent");

	const input = { command: "curl https://api.example.com/ -H 'k: {{secret:tok}}'" };
	assert.equal(await handlers.tool_call({ toolName: "bash", toolCallId: "2", input }, ctx), undefined);
	assert.ok(input.command.includes("VALUE-abc-123") || /__PI_/.test(input.command));
	const blocked = await handlers.tool_call({ toolName: "bash", toolCallId: "3", input: { command: "echo {{secret:tok}}" } }, ctx);
	assert.equal(blocked.block, true);
	const out = handlers.tool_result({ toolCallId: "2", toolName: "bash", content: [{ type: "text", text: "got VALUE-abc-123!" }] }, ctx);
	assert.equal(out.content[0].text, "got [secret:tok]!");
	assert.equal(handlers.tool_result({ toolCallId: "4", toolName: "bash", content: [{ type: "text", text: "clean" }] }, ctx), undefined);
	assert.equal(await handlers.tool_call({ toolName: "read", toolCallId: "5", input: { path: "x" } }, ctx), undefined);
});

test("secret tool: list shows names and hosts only; run injects, scrubs, and blocks printers", async () => {
	const run = (params: any) => tool.execute("t1", params, undefined, undefined, { ...ctx, cwd: process.cwd() });
	const list = (await run({ action: "list" })).content[0].text;
	assert.match(list, /tok \(var\) → https:\/\/api\.example\.com/);
	assert.ok(!list.includes("VALUE-abc-123"));
	const ok = (await run({ action: "run", command: "printf '%s' \"$(echo ok)\" ; [ {{secret:tok}} = VALUE-abc-123 ] && echo match" })).content[0].text;
	assert.ok(ok.includes("match") || ok.startsWith("Bloccato"), ok);
	const bad = (await run({ action: "run", command: "echo {{secret:tok}}" })).content[0].text;
	assert.match(bad, /^Bloccato/);
	assert.ok(!bad.includes("VALUE-abc-123"));
});
