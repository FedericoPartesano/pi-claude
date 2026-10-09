// Header and sidebar facts: git branch and changes of the project, subscription usage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitStatus, readUsage } from "../info.mjs";

test("git status: branch and the number of changed files", () => {
	assert.deepEqual(parseGitStatus("## main...origin/main [ahead 1]\n M src/cart.js\n?? test/cart.test.js\n"), { branch: "main", changes: 2 });
	assert.deepEqual(parseGitStatus("## feat/x\n"), { branch: "feat/x", changes: 0 });
	assert.deepEqual(parseGitStatus("## No commits yet on main\n"), { branch: "main", changes: 0 });
	assert.deepEqual(parseGitStatus("## HEAD (no branch)\n M a\n"), { branch: "HEAD", changes: 1 });
	assert.deepEqual(parseGitStatus(""), {});
});

test("usage: the file pi-claude-code writes, as percentages; missing or broken means none", () => {
	const dir = mkdtempSync(join(tmpdir(), "desk-usage-"));
	const file = join(dir, "usage.json");
	writeFileSync(file, JSON.stringify({ fiveHourUtilization: 0.34, sevenDayUtilization: 0.18, isUsingOverage: false, updatedAt: "2026-10-09T14:01:50.606Z" }));
	assert.deepEqual(readUsage(file), { fiveHour: 34, sevenDay: 18, overage: false, updatedAt: "2026-10-09T14:01:50.606Z" });
	writeFileSync(file, "{");
	assert.equal(readUsage(file), undefined);
	assert.equal(readUsage(join(dir, "none.json")), undefined);
});

test("open outside: web addresses (with or without scheme) and files inside the project only", async () => {
	const { externalTarget } = await import("../info.mjs");
	assert.deepEqual(externalTarget("https://a.it/x", "/p"), { url: "https://a.it/x" });
	assert.deepEqual(externalTarget("localhost:3000/cart", "/p"), { url: "http://localhost:3000/cart" });
	assert.deepEqual(externalTarget("out/vendite.png", "/p"), { path: "/p/out/vendite.png" });
	assert.deepEqual(externalTarget("file:///p/a.pdf", "/p"), { path: "/p/a.pdf" });
	assert.deepEqual(externalTarget("/p/docs/spec.pdf", "/p"), { path: "/p/docs/spec.pdf" });
	assert.deepEqual(externalTarget("../etc/x.sh", "/p"), { reveal: "/etc/x.sh" });
	assert.deepEqual(externalTarget("/home/me/run.desktop", "/p"), { reveal: "/home/me/run.desktop" });
	assert.deepEqual(externalTarget("javascript:alert(1)", "/p"), {});
	assert.deepEqual(externalTarget(42, "/p"), {});
});

test("fork point: the n-th time that text was sent, not a position that slash commands can shift", async () => {
	const { forkEntry } = await import("../info.mjs");
	const messages = [{ entryId: "a", text: "ciao" }, { entryId: "b", text: "rifai" }, { entryId: "c", text: "rifai" }];
	assert.equal(forkEntry(messages, "rifai", 0), "b");
	assert.equal(forkEntry(messages, "rifai", 1), "c");
	assert.equal(forkEntry(messages, "rifai", 5), "c", "fewer in the session: the last one");
	assert.equal(forkEntry(messages, "mai detto", 0), undefined);
});
