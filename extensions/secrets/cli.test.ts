import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type IO } from "./cli.ts";
import { Vault } from "./store.ts";

const fake = (answers: string[]) => {
	const out: string[] = [];
	const asked: string[] = [];
	const next = (p: string) => { asked.push(p); return Promise.resolve(answers.shift() ?? ""); };
	const io: IO = { line: next, hidden: next, out: (t) => out.push(t) };
	return { io, out, asked };
};
const path = () => join(mkdtempSync(join(tmpdir(), "cli-")), "s.enc");

test("add creates the store, saves a login, list and rm work", async () => {
	const p = path();
	let r = fake(["master", "master", "https://example.com", "alice", "pw-1234"]);
	assert.equal(await runCli(["add", "site", "login"], r.io, p), 0);
	assert.ok(!readFileSync(p, "utf8").includes("pw-1234"));
	const v = new Vault(p);
	assert.ok(v.unlock("master"));
	assert.deepEqual(v.get("site"), { kind: "login", url: "https://example.com", user: "alice", password: "pw-1234" });
	r = fake(["master"]);
	assert.equal(await runCli(["list"], r.io, p), 0);
	assert.deepEqual(r.out, ["site\tlogin"]);
	r = fake(["master"]);
	assert.equal(await runCli(["rm", "site"], r.io, p), 0);
	assert.ok(r.out[0].startsWith("Rimosso"));
});

test("wrong passphrase, bad name, bad kind, mismatched new passphrase", async () => {
	const p = path();
	assert.equal(await runCli(["add", "x"], fake(["a", "b"]).io, p), 1);
	assert.equal(await runCli(["add", "../x"], fake([]).io, p), 2);
	assert.equal(await runCli(["add", "x", "boh"], fake([]).io, p), 2);
	assert.equal(await runCli(["add", "tok"], fake(["m", "m", "value-1", ""]).io, p), 0);
	assert.equal(await runCli(["list"], fake(["sbagliata"]).io, p), 1);
});

test("the secret fields are asked through hidden(), the others through line()", async () => {
	const p = path();
	const hidden: string[] = [];
	const lines: string[] = [];
	const io: IO = { line: (q) => { lines.push(q); return Promise.resolve("https://example.com"); }, hidden: (q) => { hidden.push(q); return Promise.resolve("m"); }, out: () => {} };
	await runCli(["add", "s", "login"], io, p);
	assert.ok(hidden.some((q) => /Password/.test(q)));
	assert.ok(!lines.some((q) => /Password/.test(q)));
});
