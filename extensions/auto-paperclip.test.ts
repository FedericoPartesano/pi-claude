import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { goalFrom, heartbeat, pick, readEnv, slugFor, verdict, type Issue, type PaperclipEnv, type Work } from "./auto/paperclip.ts";
import { runHeadless } from "./auto/headless.ts";
import { shouldDelegate, teamPlanFor, teamStep } from "./auto/team.ts";
import { newState } from "./auto/state.ts";
import { loadRoles } from "../pi-team/src/roles.ts";
import type { AgentRun } from "../pi-team/src/runner.ts";

const env: PaperclipEnv = { apiUrl: "http://pc", apiKey: "k", agentId: "a1", companyId: "c1", runId: "r1" };
const issue = (id: string, status: string, extra: Partial<Issue> = {}): Issue => ({ id, title: `T ${id}`, status, ...extra });
const work = (reason: Work["reason"], detail = "x"): Work => ({ reason, detail, branch: "auto/pc-x", worktree: "/w/x", steps: 4, tokens: 900 });

/** A fake Paperclip: records calls, answers by route. */
function server(inbox: Issue[], checkoutStatus = 200, patchStatuses: number[] = []) {
	const calls: { method: string; path: string; body?: any; run?: string }[] = [];
	const fetcher = (async (url: string, init: any) => {
		const path = String(url).replace("http://pc", "");
		const body = init.body ? JSON.parse(init.body) : undefined;
		calls.push({ method: init.method, path, body, run: init.headers["X-Paperclip-Run-Id"] });
		const reply = (status: number, json: unknown) => ({ status, ok: status < 400, text: async () => JSON.stringify(json) });
		if (path === "/api/agents/me") return reply(200, { id: "a1", companyId: "c1" });
		if (path.startsWith("/api/companies/c1/issues")) return reply(200, inbox);
		if (path.endsWith("/checkout")) return reply(checkoutStatus, {});
		if (path.endsWith("/comments")) return reply(200, [{ authorName: "board", body: "usa la cache" }]);
		if (init.method === "GET") return reply(200, { ...inbox[0], description: "descrizione" });
		if (init.method === "PATCH" && patchStatuses.length) return reply(patchStatuses.shift()!, {});
		return reply(200, {});
	}) as unknown as typeof fetch;
	return { fetcher, calls };
}

test("readEnv: names the missing variables", () => {
	assert.match(readEnv({}) as string, /PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_AGENT_ID/);
	const ok = readEnv({ PAPERCLIP_API_URL: "http://x///", PAPERCLIP_API_KEY: "k", PAPERCLIP_AGENT_ID: "a" }) as PaperclipEnv;
	assert.equal(ok.apiUrl, "http://x");
});

test("pick: the woken task if ours, then in_progress, then todo; never blocked", () => {
	const inbox = [issue("1", "blocked"), issue("2", "todo"), issue("3", "in_progress"), issue("4", "in_review")];
	assert.equal(pick(inbox)?.id, "3");
	assert.equal(pick(inbox, "2")?.id, "2");
	assert.equal(pick(inbox, "4")?.id, "4");
	assert.equal(pick(inbox, "1")?.id, "3", "a blocked task is not picked even when named");
	assert.equal(pick([issue("1", "blocked")]), undefined);
});

test("slugFor is stable and safe; goalFrom keeps title, description and the last comments", () => {
	assert.equal(slugFor({ id: "u", identifier: "ACME-12" }), "pc-acme-12");
	const goal = goalFrom(issue("1", "todo", { description: "fai X" }), Array.from({ length: 8 }, (_, n) => ({ body: `c${n}`, authorName: "b" })));
	assert.match(goal, /^T 1\n\nfai X\n\nCommenti recenti:/);
	assert.ok(goal.includes("c7") && !goal.includes("c2"));
});

test("verdict: green → in_review, time/budget → stays in_progress, stall → blocked; never done", () => {
	assert.equal(verdict(work("completato")).status, "in_review");
	for (const reason of ["budget", "tempo", "passi", "fermato"] as const) assert.equal(verdict(work(reason)).status, "in_progress");
	for (const reason of ["stallo", "stesso-errore", "check-manomessi", "piano-non-valido", "errore", "niente-da-fare"] as const) assert.equal(verdict(work(reason)).status, "blocked");
	assert.match(verdict(work("completato")).comment, /non fa merge né push/);
});

test("heartbeat: checkout with run id, work, PATCH with comment", async () => {
	const { fetcher, calls } = server([issue("7", "todo", { identifier: "ACME-7" })]);
	let goal = "";
	const result = await heartbeat(env, { fetch: fetcher, work: async (g, slug) => ((goal = `${slug}|${g}`), work("completato")) });
	assert.equal(result.outcome, "in_review");
	assert.match(goal, /^pc-acme-7\|T 7\n\ndescrizione/);
	assert.ok(goal.includes("usa la cache"));
	const order = calls.map((c) => `${c.method} ${c.path.split("?")[0]}`);
	assert.ok(order.indexOf("POST /api/issues/7/checkout") < order.indexOf("PATCH /api/issues/7"));
	const patch = calls.find((c) => c.method === "PATCH")!;
	assert.equal(patch.body.status, "in_review");
	assert.equal(patch.run, "r1");
	assert.deepEqual(calls.find((c) => c.path.endsWith("/checkout"))!.body.agentId, "a1");
});

test("heartbeat: in_review first opens a confirmation interaction, and never reassigns the issue", async () => {
	const { fetcher, calls } = server([issue("7", "todo")]);
	await heartbeat(env, { fetch: fetcher, work: async () => work("completato") });
	const order = calls.map((c) => `${c.method} ${c.path.split("?")[0]}`);
	assert.ok(order.indexOf("POST /api/issues/7/interactions") < order.indexOf("PATCH /api/issues/7"));
	assert.equal(calls.find((c) => c.path.endsWith("/interactions"))!.body.kind, "request_confirmation");
	assert.equal(calls.find((c) => c.method === "PATCH")!.body.assigneeUserId, undefined);
});

test("heartbeat: in_review refused with 422 → blocked with the result in the comment, no error loop", async () => {
	const { fetcher, calls } = server([issue("7", "todo")], 200, [422]);
	const result = await heartbeat(env, { fetch: fetcher, work: async () => work("completato") });
	assert.equal(result.outcome, "blocked");
	const patches = calls.filter((c) => c.method === "PATCH");
	assert.equal(patches.length, 2);
	assert.equal(patches[1].body.status, "blocked");
	assert.match(patches[1].body.comment, /revisione umana/);
});

test("heartbeat: 409 on checkout → stop, no work, no retry", async () => {
	const { fetcher, calls } = server([issue("7", "todo")], 409);
	let ran = false;
	const result = await heartbeat(env, { fetch: fetcher, work: async () => ((ran = true), work("completato")) });
	assert.equal(result.outcome, "occupato");
	assert.equal(ran, false);
	assert.equal(calls.filter((c) => c.path.endsWith("/checkout")).length, 1);
	assert.equal(calls.some((c) => c.method === "PATCH"), false);
});

test("heartbeat: empty inbox is not an error; a work crash blocks the issue with a comment", async () => {
	assert.equal((await heartbeat(env, { fetch: server([]).fetcher, work: async () => work("completato") })).outcome, "nessun-lavoro");
	const { fetcher, calls } = server([issue("7", "todo")]);
	const result = await heartbeat(env, { fetch: fetcher, work: async () => Promise.reject(new Error("serve un repository git")) });
	assert.equal(result.outcome, "blocked");
	const patch = calls.find((c) => c.method === "PATCH")!;
	assert.equal(patch.body.status, "blocked");
	assert.match(patch.body.comment, /serve un repository git/);
});

test("heartbeat: API down → errore (exit 1), nothing thrown", async () => {
	const down = (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
	assert.equal((await heartbeat(env, { fetch: down, work: async () => work("completato") })).outcome, "errore");
});

function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "pc-repo-"));
	const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
	run("init", "-q", "-b", "main");
	run("config", "user.email", "t@t");
	run("config", "user.name", "t");
	writeFileSync(join(dir, "a.txt"), "x");
	run("add", "-A");
	run("commit", "-qm", "init");
	return dir;
}

test("runHeadless: creates the worktree and state; a second call with the same slug resumes", async () => {
	const dir = repo();
	const slug = `pc-t-${process.pid}`;
	let first: any;
	const done = async (state: any) => ((state.stop = { reason: "tempo", detail: "scaduto", at: 1 }), state);
	const a = await runHeadless({ cwd: dir, goal: "goal", slug, run: async (s) => done((first = s)) });
	assert.equal(a.branch, `auto/${slug}`);
	assert.ok(existsSync(a.worktree));
	a.steps = 5;
	let second: any;
	let stopAtEntry: unknown = "unset";
	await runHeadless({ cwd: dir, goal: "altro", slug, run: async (s) => ((stopAtEntry = s.stop), done((second = s))) });
	assert.equal(second.worktree, first.worktree);
	assert.equal(second.goal, "goal", "resumed, not restarted");
	assert.equal(stopAtEntry, undefined, "old stop cleared");
	execFileSync("git", ["worktree", "remove", "--force", a.worktree], { cwd: dir });
});

test("team: delegated only on a build step after repeated failures, or always/off by env", () => {
	const build = (failures: number) => ({ phase: "build" as const, prompt: "p", readOnly: [], requirement: { id: "R1", check: "true", failures } });
	assert.equal(shouldDelegate(build(0), ""), false);
	assert.equal(shouldDelegate(build(1), ""), false);
	assert.equal(shouldDelegate(build(2), ""), true);
	assert.equal(shouldDelegate(build(0), "always"), true);
	assert.equal(shouldDelegate(build(9), "off"), false);
	assert.equal(shouldDelegate({ phase: "plan", prompt: "p", readOnly: [] }, "always"), false);
});

test("teamStep: implementer then reviewer run with the auto guard; the frozen check decides", async () => {
	const state = newState({ goal: "g", slug: "s", branch: "auto/s", repo: "/r", worktree: tmpdir(), base: "abc", intent: "i", started: 0, deadline: 1 });
	const request = { phase: "build" as const, prompt: "implementa R1", readOnly: [], requirement: { id: "R1", check: "echo ok", failures: 2 } };
	assert.equal(teamPlanFor(state, request).tasks[0].verify?.[0], "echo ok");
	const seen: { role: string; args: string[]; guard: string | undefined }[] = [];
	const runAgent = async (r: any): Promise<AgentRun> => {
		seen.push({ role: r.role.name, args: r.extraArgs, guard: r.env?.PI_AUTO_PHASE });
		return { ok: true, text: r.role.name === "reviewer" ? "VERDETTO: approvato\nok" : "## Risultati\nfatto", inputTokens: 100, outputTokens: 10, requests: 1, seconds: 1 };
	};
	let checks = 0;
	const result = await teamStep(state, request, { gitDir: "/g", skillsDir: "/s" }, { runAgent, roles: loadRoles(), check: async () => ((checks++), { ok: true, output: "" }) });
	assert.equal(result.ok, true);
	assert.ok(result.tokens >= 110);
	assert.ok(seen.length >= 1 && seen[0].role === "implementer");
	for (const s of seen) {
		assert.ok(s.args.includes("--no-extensions") && s.args.some((a) => a.endsWith("auto-worker.ts")), "worker guard loaded");
		assert.equal(s.guard, "build");
	}
	assert.ok(checks >= 1, "verification goes through the supervisor's sandboxed check");

	const failing = await teamStep(state, request, { gitDir: "/g", skillsDir: "/s" }, { runAgent, roles: loadRoles(), check: async () => ({ ok: false, output: "rosso" }) });
	assert.equal(failing.ok, false);
	assert.match(failing.error ?? "", /^team:/);
});

test("loop: a build step carries its requirement and the count of failures in a row (team escalation input)", async () => {
	const { runAuto } = await import("./auto/loop.ts");
	const { spawnSync } = await import("node:child_process");
	const { mkdirSync } = await import("node:fs");
	const dir = repo();
	const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
	const state = newState({ goal: "crea hello.txt", slug: "hello", branch: "main", repo: dir, worktree: dir, base, intent: "intents/2026-01-01-hello.md", started: 0, deadline: 10_000_000 });
	const seen: (number | undefined)[] = [];
	let now = 1_000;
	let builds = 0;
	await runAuto(state, {
		step: async (s, request) => {
			const at = (path: string) => join(s.worktree, path);
			if (request.phase === "define") {
				mkdirSync(at("intents"), { recursive: true });
				writeFileSync(at(s.intent), "---\nstatus: in-progress\n---\n# H\n\n## Outcome atteso\n- [ ] hello.txt\n");
				const { PROJECT_DOCS, docsDir } = await import("./auto/docs.ts");
				mkdirSync(join(s.worktree, docsDir(s.worktree)), { recursive: true });
				for (const doc of PROJECT_DOCS) writeFileSync(join(s.worktree, docsDir(s.worktree), doc.file), `# ${doc.title}\n\nContenuto concreto del documento di progetto, abbastanza lungo da contare come scritto.\n`);
			}
			if (request.phase === "plan") {
				mkdirSync(at("auto"), { recursive: true });
				writeFileSync(at("auto/requisiti.json"), JSON.stringify({ requisiti: [{ id: "R1", descrizione: "d", check: "grep -q ciao hello.txt", prova: "p" }] }));
			}
			if (request.phase === "build") {
				seen.push(request.requirement?.failures);
				builds++;
				writeFileSync(at("hello.txt"), builds >= 3 ? "ciao\n" : `no${builds}\n`);
			}
			return { ok: true, text: "", tokens: 1 };
		},
		check: async (command, cwd) => {
			const out = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });
			return { ok: out.status === 0, output: `${out.stdout}${out.stderr}` };
		},
		git: async (cwd, args) => {
			const out = spawnSync("git", args, { cwd, encoding: "utf8" });
			return { ok: out.status === 0, out: `${out.stdout}${out.stderr}` };
		},
		usage: () => undefined,
		now: () => (now += 1000),
		save: () => {},
		stopped: () => false,
	});
	assert.deepEqual(seen.slice(0, 3), [0, 1, 2]);
});
