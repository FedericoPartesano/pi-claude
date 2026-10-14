import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import advisor, { intentMarkdown, isHaiku, nativeAdvisorOn, recentChat } from "./advisor.ts";

const msg = (role: string, content: unknown, toolName?: string) => ({ type: "message", message: { role, content, toolName } });
const text = (t: string) => [{ type: "text", text: t }];

test("recentChat: ultimi N righe, include tool call e risultati, taglia", () => {
	const branch = [
		msg("user", text("a")),
		{ type: "label" },
		msg("assistant", [{ type: "text", text: "b" }, { type: "toolCall", name: "bash", arguments: { command: "ls" } }]),
		msg("toolResult", text("x".repeat(600)), "bash"),
		msg("user", text("c".repeat(50))),
	];
	const out = recentChat(branch, 3, 10);
	assert.equal(out, `Tool call: bash {"command":"ls"}\n\nTool result (bash): ${"x".repeat(500)}…\n\nUser: ${"c".repeat(10)}…`);
	assert.equal(recentChat([], 5), "");
});

test("isHaiku", () => {
	assert.equal(isHaiku("claude-haiku-4-5"), true);
	assert.equal(isHaiku("opus"), false);
	assert.equal(isHaiku(undefined), false);
});

function fake(modelId: string, answer = "usa X") {
	const handlers = new Map<string, ((e: unknown, c: unknown) => unknown)[]>();
	let tool: { execute: (...a: unknown[]) => Promise<{ content: { text: string }[]; isError?: boolean }> } | undefined;
	let calls = 0;
	const commands = new Map<string, (a: string, x: unknown) => Promise<void>>();
	const notes: string[] = [];
	const ctx = {
		hasUI: false,
		cwd: "",
		ui: { notify: (t: string) => void notes.push(t) },
		model: { id: modelId },
		sessionManager: { getBranch: () => [msg("user", text("fai Y"))] },
		modelRegistry: {
			find: () => ({ id: "opus" }),
			streamSimple: () => {
				calls++;
				return { async *[Symbol.asyncIterator]() {}, result: async () => ({ stopReason: "stop", content: [{ type: "text", text: answer }] }) };
			},
		},
	};
	const pi = {
		on: (name: string, h: (e: unknown, c: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
		registerTool: (t: never) => void (tool = t),
		registerCommand: (name: string, c: { handler: (a: string, x: unknown) => Promise<void> }) => void commands.set(name, c.handler),
	};
	const emit = async (name: string, event: unknown) => {
		let result: unknown;
		for (const h of handlers.get(name) ?? []) result = (await h(event, ctx)) ?? result;
		return result as Record<string, unknown> | undefined;
	};
	advisor(pi as never);
	return { tool: tool!, ctx, emit, calls: () => calls, commands, notes };
}

test("intentMarkdown: toglie recinto e testo prima del frontmatter", () => {
	assert.equal(intentMarkdown("```markdown\n---\nstatus: ready\n---\n# Intent: x\n```"), "---\nstatus: ready\n---\n# Intent: x\n");
	assert.equal(intentMarkdown("Ecco:\n---\na: 1\n---\nbody"), "---\na: 1\n---\nbody\n");
	assert.equal(intentMarkdown("niente frontmatter"), undefined);
});

test("/brief: Opus scrive l'intent in intents/ e lo segna ready", async () => {
	const dir = mkdtempSync(join(tmpdir(), "brief-"));
	const answer = "```markdown\n---\nstatus: draft\ncreated: 2026-10-14\nsource: user\n---\n# Cache TTL\n\n## Problema\nServe una cache.\n\n## Outcome atteso\n- cache.js esporta TtlCache\n\n## Utenti e sistemi impattati\nCodice interno.\n\n## Vincoli\n- Nessuna dipendenza.\n\n## Domande aperte\n- nessuna\n\n## Verifica\n```bash\nnode --test\n```\n```";
	const f = fake("claude-haiku-4-5", answer);
	f.ctx.cwd = dir;
	await f.commands.get("brief")!("una cache con TTL", f.ctx);
	const files = readdirSync(join(dir, "intents"));
	assert.equal(files.length, 1);
	assert.match(files[0], /^\d{4}-\d{2}-\d{2}-cache-ttl\.md$/);
	const text = readFileSync(join(dir, "intents", files[0]), "utf8");
	assert.match(text, /^---\nstatus: ready/);
	assert.match(f.notes.join("\n"), /\/goal @intents\//);
	await f.commands.get("brief")!("", f.ctx);
	assert.match(f.notes.at(-1)!, /Uso: \/brief/);
});

test("/advisor: off e on cambiano lo stato e il badge ADVISOR compare solo con Haiku", async () => {
	const prev = process.env.PI_CLAUDE_ADVISOR;
	process.env.PI_CLAUDE_ADVISOR = "on";
	try {
		const f = fake("claude-haiku-4-5");
		const statuses: (string | undefined)[] = [];
		(f.ctx as { hasUI: boolean }).hasUI = true;
		(f.ctx.ui as Record<string, unknown>).setStatus = (_key: string, text?: string) => void statuses.push(text);
		await f.emit("session_start", {});
		assert.equal(statuses.at(-1), "ON");
		await f.commands.get("advisor")!("off", f.ctx);
		assert.equal(process.env.PI_CLAUDE_ADVISOR, "off");
		assert.equal(statuses.at(-1), undefined);
		assert.match(f.notes.at(-1)!, /spento/);
		await f.commands.get("advisor")!("on", f.ctx);
		assert.equal(process.env.PI_CLAUDE_ADVISOR, "on");
		assert.equal(statuses.at(-1), "ON");
		assert.equal(nativeAdvisorOn("claude-sonnet-4-5"), false);
		await f.emit("model_select", { model: { id: "claude-sonnet-4-5" } });
		assert.equal(statuses.at(-1), undefined);
	} finally {
		if (prev === undefined) delete process.env.PI_CLAUDE_ADVISOR;
		else process.env.PI_CLAUDE_ADVISOR = prev;
	}
});
