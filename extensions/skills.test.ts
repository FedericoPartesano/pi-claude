import assert from "node:assert/strict";
import { test } from "node:test";
import skills, { skillLine, repoContext, skillBody, SKILLS_DIR } from "./skills.ts";

function fake() {
	const handlers: Record<string, Function> = {};
	const commands: Record<string, any> = {};
	const status: (string | undefined)[] = [];
	const notes: string[] = [];
	const states: any[] = [];
	skills({ registerMessageRenderer: () => {}, events: { emit: (_n: string, d: any) => void states.push(d) }, on: (e: string, h: Function) => void (handlers[e] = h), registerCommand: (n: string, c: any) => void (commands[n] = c) } as any);
	const ctx = { cwd: "/nonexistent", hasUI: true, ui: { setStatus: (_k: string, t?: string) => void status.push(t), notify: (t: string) => void notes.push(t) } };
	return { handlers, commands, status, notes, ctx, states };
}
const user = (prompt: string) => ({ messageType: "user", prompt });

test("un messaggio da bug inietta la skill di debug, mostra una riga compatta e mette il chip", () => {
	const f = fake();
	const out = f.handlers.before_agent_start(user("il parser non funziona, risolvi il bug"), f.ctx);
	assert.equal(out.message.display, true);
	assert.match(out.message.content, /^# Skill attivata: debugging-and-error-recovery/);
	assert.doesNotMatch(out.message.content, /disable-model-invocation/);
	assert.deepEqual(f.status, ["debugging-and-error-recovery"]);
	f.handlers.agent_end({}, f.ctx);
	assert.equal(f.status.at(-1), undefined);
});

test("messaggio neutro: nessuna iniezione, nessun chip", () => {
	const f = fake();
	assert.equal(f.handlers.before_agent_start(user("ciao"), f.ctx), undefined);
	assert.deepEqual(f.status, []);
});

test("la stessa skill non riparte nella sessione; /skills reset la riabilita", async () => {
	const f = fake();
	assert.ok(f.handlers.before_agent_start(user("non funziona, risolvi il bug"), f.ctx));
	assert.equal(f.handlers.before_agent_start(user("non va, risolvi il bug"), f.ctx), undefined);
	await f.commands.skills.handler("reset", f.ctx);
	assert.ok(f.handlers.before_agent_start(user("non va, risolvi il bug"), f.ctx));
});

test("/skills off spegne una skill; senza argomenti mostra lo storico", async () => {
	const f = fake();
	await f.commands.skills.handler("off debugging-and-error-recovery", f.ctx);
	assert.equal(f.handlers.before_agent_start(user("non funziona, risolvi il bug"), f.ctx), undefined);
	await f.commands.skills.handler("on debugging-and-error-recovery", f.ctx);
	f.handlers.before_agent_start(user("non funziona, risolvi il bug"), f.ctx);
	await f.commands.skills.handler("", f.ctx);
	assert.match(f.notes.at(-1)!, /debugging-and-error-recovery — testo: «bug»/);
});

test("messaggi non utente (steer, ecc.) non attivano niente", () => {
	const f = fake();
	assert.equal(f.handlers.before_agent_start({ messageType: "custom", prompt: "bug" }, f.ctx), undefined);
});

test("repoContext fuori da un repo non rompe; skillBody toglie il frontmatter", () => {
	assert.deepEqual(repoContext("/nonexistent"), {});
	assert.doesNotMatch(skillBody(SKILLS_DIR, "agent-skills/skills/code-review-and-quality"), /disable-model-invocation/);
});

test("una skill solo suggerita non inietta nulla: chip «suggerita», storico a 0 token", () => {
	const f = fake();
	assert.equal(f.handlers.before_agent_start(user("puoi controllare i test e il branch"), f.ctx), undefined);
	assert.match(String(f.status.at(-1)), /^\? /);
});

test("publishes the panel state on activation, on/off and agent end", async () => {
	const f = fake();
	await f.handlers.before_agent_start(user("committa le modifiche"), f.ctx);
	const last = () => f.states.at(-1);
	assert.equal(last().current[0].tier, "auto");
	assert.equal(last().history.length, 1);
	await f.commands.skills.handler("off git-workflow-and-versioning", f.ctx);
	assert.deepEqual(last().off, ["git-workflow-and-versioning"]);
	await f.handlers.agent_end({}, f.ctx);
	assert.deepEqual(last().current, []);
});

test("the flow line is compact, one per skill, and the signals only when expanded", async () => {
	const f = fake();
	const r = await f.handlers.before_agent_start(user("committa le modifiche"), f.ctx);
	assert.equal(r.message.display, true);
	const compact = skillLine(r.message.details, false, 100);
	assert.equal(compact.length, 2);
	assert.match(compact[1], /^ ↳ skill: git-workflow-and-versioning — .+ \(~\d+ token\)$/);
	assert.ok(skillLine(r.message.details, true, 100).length > 2);
	for (const line of skillLine(r.message.details, true, 30)) assert.ok(line.length <= 30);
	assert.deepEqual(skillLine(undefined, false, 80), []);
});
