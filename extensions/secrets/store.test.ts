import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./store.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "vault-")), "s.enc");

test("creates, locks and unlocks; file is 0600 and holds no plaintext", () => {
	const path = tmp();
	const v = new Vault(path);
	assert.equal(v.unlock("master"), true);
	v.set("tok", { kind: "var", value: "S3CRET-VALUE" });
	v.set("site", { kind: "login", url: "https://example.com/login", user: "alice", password: "p4ss-word" });
	assert.equal(statSync(path).mode & 0o777, 0o600);
	const raw = readFileSync(path, "utf8");
	for (const leak of ["S3CRET-VALUE", "p4ss-word", "alice", "example.com"]) assert.ok(!raw.includes(leak), leak);
	v.lock();
	assert.equal(v.get("tok"), undefined);
	const w = new Vault(path);
	assert.equal(w.unlock("sbagliata"), false);
	assert.equal(w.unlock("master"), true);
	assert.deepEqual(w.get("tok"), { kind: "var", value: "S3CRET-VALUE" });
	assert.deepEqual(w.names(), ["site", "tok"]);
});

test("a blob cannot be moved between names (AAD) and tampering fails closed", () => {
	const path = tmp();
	const v = new Vault(path);
	v.unlock("m");
	v.set("a", { kind: "var", value: "AAAA" });
	v.set("b", { kind: "var", value: "BBBB" });
	const data = JSON.parse(readFileSync(path, "utf8"));
	data.entries.b = data.entries.a;
	writeFileSync(path, JSON.stringify(data));
	const w = new Vault(path);
	assert.equal(w.unlock("m"), true);
	assert.equal(w.get("b"), undefined);
	assert.deepEqual(w.get("a"), { kind: "var", value: "AAAA" });
	writeFileSync(path, "{not json");
	assert.equal(new Vault(path).unlock("m"), false);
});

test("rejects bad names, remove works, values() lists decrypted strings", () => {
	const v = new Vault(tmp());
	v.unlock("m");
	assert.throws(() => v.set("bad name", { kind: "var", value: "x" }));
	assert.throws(() => v.set("../x", { kind: "var", value: "x" }));
	v.set("sudo", { kind: "sudo", password: "rootpw" });
	assert.deepEqual(v.values(), [{ name: "sudo", value: "rootpw" }]);
	assert.equal(v.remove("sudo"), true);
	assert.equal(v.remove("sudo"), false);
});
