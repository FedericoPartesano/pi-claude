// The manager guards of index.ts, through a fake extension API and a fake `pi` for the agents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FAKE_PI = new URL("./fixtures/fake-pi.mjs", import.meta.url).pathname;

async function loadExtension() {
	// A clean home: no usage file (budget 2), no user roles, no lessons.
	process.env.HOME = mkdtempSync(join(tmpdir(), "pi-team-home-"));
	Object.assign(process.env, { PI_TEAM_PI_BINARY: FAKE_PI, PI_TEAM_AUTO_APPROVE: "1" });
	const { default: extension } = await import(`../index.ts?${Date.now()}`);
	const handlers = new Map<string, (event: any, ctx?: any) => any>();
	const tools = new Map<string, any>();
	extension({
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerTool: (definition: any) => tools.set(definition.name, definition),
	} as any);
	const ctx = { cwd: mkdtempSync(join(tmpdir(), "pi-team-cwd-")), hasUI: false, getContextUsage: () => undefined, ui: {} };
	return {
		start: (prompt: string, systemPrompt = "BASE") => handlers.get("before_agent_start")!({ prompt, systemPrompt }, ctx),
		call: (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input, toolCallId: "x" }),
		team: (plan: unknown) => tools.get("team").execute("id", plan, undefined, undefined, ctx),
		parallel: (request: unknown) => tools.get("parallel").execute("id", request, undefined, undefined, ctx),
		ctx,
	};
}

const scout = (id: string, extra: Record<string, unknown> = {}) => ({ id, role: "scout", title: id, instructions: "Leggi il progetto e riporta i fatti utili al compito", ...extra });

test("when the user asks for the team, the manager cannot edit before calling it", async () => {
	const pi = await loadExtension();
	await pi.start("Usa il tool team per questo lavoro.\n\nrifai il carrello");
	assert.equal((await pi.call("edit", { path: "a.js" }))?.block, true);
	assert.equal((await pi.call("read", { path: "a.js" }))?.block, undefined, "reading is fine");

	// The team says the job is too small: from now on the manager does it itself.
	const rejected = await pi.team({ goal: "g", tasks: [scout("t1")] });
	assert.match(rejected.content[0].text, /one task/);
	assert.equal((await pi.call("edit", { path: "a.js" }))?.block, undefined);

	// A new request without the team: no guard.
	await pi.start("correggi il refuso");
	assert.equal((await pi.call("write", { path: "a.js" }))?.block, undefined);
});

test("after a verified report, re-running the same checks is blocked until files change", async () => {
	const pi = await loadExtension();
	await pi.start("usa il team per esplorare");
	const result = await pi.team({ goal: "g", tasks: [scout("t1", { verify: ["true"] }), scout("t2")], finalVerify: ["test 1 -eq 1"], review: false });
	assert.match(result.content[0].text, /VERIFICATO/);
	assert.equal(result.details.board.phase, "done");
	assert.equal((await pi.call("bash", { command: "test 1 -eq 1" }))?.block, true);
	assert.equal((await pi.call("bash", { command: " true " }))?.block, true);
	assert.equal((await pi.call("bash", { command: "ls" }))?.block, undefined);
	// After an edit the checks are worth running again.
	await pi.call("edit", { path: "a.js" });
	assert.equal((await pi.call("bash", { command: "test 1 -eq 1" }))?.block, undefined);
});

test("a member recruited by an approved plan stays in the team for the next plans", async () => {
	const pi = await loadExtension();
	const { existsSync } = await import("node:fs");
	const { USER_ROLES_DIRECTORY } = await import("../src/roles.ts");
	const analyst = { name: "vue-scout", extends: "scout", description: "Esplora progetti Vue", stack: ["vue"], instructions: "- Trova componenti .vue, store Pinia e rotte.\n- Riporta convenzioni di naming e struttura delle cartelle.\n- Segnala test esistenti e come si lanciano." };
	const first = await pi.team({ goal: "g", tasks: [scout("t1", { role: "vue-scout" }), scout("t2")], newRoles: [analyst], review: false });
	assert.match(first.content[0].text, /Nuovi membri nel team: vue-scout \(salvati in ~\/\.pi\/agent\/team\/roles\/vue-scout\.md\)/);
	assert.ok(existsSync(join(USER_ROLES_DIRECTORY, "vue-scout.md")));
	assert.ok(USER_ROLES_DIRECTORY.startsWith(tmpdir()), "a temporary home, never the real one");
	const second = await pi.team({ goal: "g", tasks: [scout("t1", { role: "vue-scout" }), scout("t2")], review: false });
	assert.doesNotMatch(second.content[0].text, /Piano non valido/);
});

test("plain requests leave the system prompt alone; the team guidance arrives only when the team is asked for", async () => {
	const pi = await loadExtension();
	assert.equal(await pi.start("correggi il refuso"), undefined);
	const team = await pi.start("usa il team per rifare il carrello");
	assert.equal(team.systemPrompt, undefined);
});

test("parallel runs independent tasks without approval and reports each one", async () => {
	const pi = await loadExtension();
	delete process.env.PI_TEAM_AUTO_APPROVE;
	const instructions = "Leggi il progetto e riporta i fatti utili al compito";
	const result = await pi.parallel({ goal: "g", tasks: [{ role: "scout", title: "a", instructions, verify: ["true"] }, { role: "scout", title: "b", instructions }] });
	process.env.PI_TEAM_AUTO_APPROVE = "1";
	assert.match(result.content[0].text, /# Parallel: 2\/2 compiti completati/);
	assert.match(result.content[0].text, /✓ p1 \[scout\] a · ✓ `true`/);
	assert.equal(result.details.board.phase, "done");
	assert.equal((await pi.call("bash", { command: "true" }))?.block, true, "its checks already ran");
});

test("parallel refuses writers that share files, before running anything", async () => {
	const pi = await loadExtension();
	const instructions = "Aggiungi la funzione richiesta e il suo test nel modulo";
	const result = await pi.parallel({ goal: "g", tasks: [
		{ role: "implementer", title: "a", instructions, files: ["src/"], verify: ["true"] },
		{ role: "implementer", title: "b", instructions, files: ["src/cart.js"], verify: ["true"] },
	] });
	assert.match(result.content[0].text, /"p1" and "p2" both change `src\/`: writers must have disjoint files/);
});
