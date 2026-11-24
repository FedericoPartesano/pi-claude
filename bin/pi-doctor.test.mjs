import assert from "node:assert/strict";
import { test } from "node:test";
import { aiArgs, aiPrompt, depsInstalled, diagnose, nextFixes, packageState, sameJson } from "./pi-doctor.mjs";

// A healthy install as gather() would describe it; each test breaks one thing.
const healthy = () => ({
	node: "v24.15.0",
	npm: true,
	claude: "2.1.328",
	pi: "1.5.2",
	wantedPi: "1.0.4",
	settingsDrift: false,
	acpDrift: false,
	packages: [
		{ source: "/home/u/pi-claude", state: "ok" },
		{ source: "npm:billion-context-pi@0.1.83", state: "ok" },
	],
	folders: [{ dir: ".", modules: true }, { dir: "pi-memory", modules: true }],
	repo: "/home/u/pi-claude",
});
const problems = (facts) => diagnose(facts).filter((c) => !c.ok && c.level === "err");

test("healthy install: no problems, a different Pi version is only a note", () => {
	assert.deepEqual(problems(healthy()), []);
	const pi = diagnose(healthy()).find((c) => c.id === "pi");
	assert.equal(pi.ok, true);
	assert.match(pi.text, /1\.5\.2.*testata con 1\.0\.4/);
});

test("a configured package that was never downloaded (PI_OFFLINE skips it): pi install, without PI_OFFLINE", () => {
	const facts = healthy();
	facts.packages[1].state = "missing";
	const [p] = problems(facts);
	assert.match(p.text, /billion-context-pi@0\.1\.83.*non scaricato/);
	assert.deepEqual(p.fix.cmd, ["pi", "install", "npm:billion-context-pi@0.1.83"]);
	assert.equal(p.fix.env.PI_OFFLINE, undefined);
	assert.equal("PI_OFFLINE" in p.fix.env, true);
});

test("an npm package at another version than the pinned one is reinstalled", () => {
	const facts = healthy();
	facts.packages[1].state = "0.1.80";
	const [p] = problems(facts);
	assert.match(p.text, /0\.1\.80/);
	assert.deepEqual(p.fix.cmd, ["pi", "install", "npm:billion-context-pi@0.1.83"]);
});

test("settings or acp.json not what setup.mjs writes: setup.mjs runs first", () => {
	const facts = healthy();
	facts.settingsDrift = true;
	facts.acpDrift = true;
	facts.packages[1].state = "missing";
	const list = problems(facts);
	assert.equal(list.length, 3);
	assert.deepEqual(list[0].fix.cmd, [process.execPath, "/home/u/pi-claude/scripts/setup.mjs"]);
	assert.equal(list[0].fix, list[1].fix);
});

test("dependencies missing in a folder: npm install there, CUDA download skipped", () => {
	const facts = healthy();
	facts.folders[1].modules = false;
	const [p] = problems(facts);
	assert.deepEqual(p.fix.cmd, ["npm", "install", "--no-audit", "--no-fund", "--loglevel=error"]);
	assert.equal(p.fix.cwd, "/home/u/pi-claude/pi-memory");
	assert.equal(p.fix.env.ONNXRUNTIME_NODE_INSTALL_CUDA, "skip");
});

test("old Node: an error with the way out, no automatic fix", () => {
	const facts = healthy();
	facts.node = "v22.12.0";
	const [p] = problems(facts);
	assert.match(p.text, /22\.19/);
	assert.equal(p.fix, undefined);
});

test("Pi or claude missing: installed with npm -g (Pi at the tested version)", () => {
	const facts = healthy();
	facts.pi = undefined;
	facts.claude = undefined;
	const list = problems(facts);
	assert.deepEqual(list.map((p) => p.fix.cmd), [
		["npm", "install", "-g", "@earendil-works/pi-coding-agent@1.0.4"],
		["npm", "install", "-g", "@anthropic-ai/claude-code"],
	]);
});

test("packageState: npm pinned versions compared, other sources only need to exist", () => {
	const versions = { "billion-context-pi": "0.1.83", "@juicesharp/rpiv-todo": "2.10.0" };
	const read = (name) => versions[name];
	const exists = (path) => path === "/home/u/pi-claude";
	assert.equal(packageState("npm:billion-context-pi@0.1.83", read, exists), "ok");
	assert.equal(packageState("npm:@juicesharp/rpiv-todo@2.11.0", read, exists), "2.10.0");
	assert.equal(packageState("npm:pi-web-access@0.31.0", read, exists), "missing");
	assert.equal(packageState("npm:pi-web-access", (n) => (n === "pi-web-access" ? "9.9.9" : undefined), exists), "ok");
	assert.equal(packageState("/home/u/pi-claude", read, exists), "ok");
	assert.equal(packageState("/home/u/altro", read, exists), "missing");
});

test("aiPrompt: short, carries the problems and the failed fix output, asks not to run anything", () => {
	const facts = healthy();
	facts.packages[1].state = "missing";
	const prompt = aiPrompt(diagnose(facts), [{ cmd: "pi install npm:billion-context-pi@0.1.83", output: "npm ERR! 404" }], "linux");
	assert.match(prompt, /billion-context-pi/);
	assert.match(prompt, /npm ERR! 404/);
	assert.match(prompt, /linux/);
	assert.match(prompt, /Do not run/);
	assert.match(prompt, /`pi doctor`/);
	assert.ok(prompt.length < 2000);
});

test("depsInstalled: a dependency resolved from the repo root counts (Node walks up), a missing one does not", () => {
	const present = new Set(["/r/node_modules/@huggingface/transformers", "/r/pi-ui/node_modules/x"]);
	const exists = (p) => present.has(p);
	assert.equal(depsInstalled("/r", "pi-memory", ["@huggingface/transformers"], exists), true);
	assert.equal(depsInstalled("/r", "pi-ui", ["x"], exists), true);
	assert.equal(depsInstalled("/r", "pi-ui", ["x", "y"], exists), false);
	assert.equal(depsInstalled("/r", ".", ["x"], exists), false);
});

test("aiArgs: haiku with no tools, no MCP servers, no saved session (one cheap answer)", () => {
	const args = aiArgs("p");
	assert.deepEqual(args.slice(0, 3), ["-p", "--model", "haiku"]);
	assert.equal(args[args.indexOf("--tools") + 1], "");
	assert.ok(args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
	assert.equal(args.at(-1), "p");
});

test("nextFixes: one run per fix object, a fix that already failed is not retried", () => {
	const facts = healthy();
	facts.settingsDrift = true;
	facts.acpDrift = true;
	facts.packages[1].state = "missing";
	const checks = diagnose(facts);
	assert.equal(nextFixes(checks, new Set()).length, 2);
	assert.deepEqual(nextFixes(checks, new Set(["pi install npm:billion-context-pi@0.1.83"])).map((f) => f.cmd[1]), ["/home/u/pi-claude/scripts/setup.mjs"]);
});

test("sameJson: key order does not matter (setup.mjs merges as {...profile, ...mine}), values and array order do", () => {
	assert.ok(sameJson({ a: 1, nudge: { x: 1, y: [1, 2] } }, { nudge: { y: [1, 2], x: 1 }, a: 1 }));
	assert.ok(!sameJson({ nudge: { x: 1 } }, { nudge: { x: 2 } }));
	assert.ok(!sameJson({ y: [1, 2] }, { y: [2, 1] }));
	assert.ok(!sameJson({ a: 1 }, { a: 1, b: 2 }));
});
