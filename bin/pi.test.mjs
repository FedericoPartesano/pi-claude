import assert from "node:assert/strict";
import test from "node:test";
import { isClassic } from "./pi.mjs";

test("the new frontend is the default on a TTY", () => {
	assert.equal(isClassic([], {}, true), false);
	assert.equal(isClassic(["--model", "haiku", "-r"], {}, true), false);
	assert.equal(isClassic(["@intents/x.md"], {}, true), false);
});
test("classic by option or environment", () => {
	assert.equal(isClassic(["--classic"], {}, true), true);
	assert.equal(isClassic([], { PI_UI_CLASSIC: "1" }, true), true);
	assert.equal(isClassic([], { PI_UI: "off" }, true), true);
});
test("non-interactive uses and pipes stay classic", () => {
	assert.equal(isClassic(["-p", "ciao"], {}, true), true);
	assert.equal(isClassic(["--mode", "rpc"], {}, true), true);
	assert.equal(isClassic(["--version"], {}, true), true);
	assert.equal(isClassic(["install", "npm:x"], {}, true), true);
	assert.equal(isClassic([], {}, false), true);
});

test("sub-agents: extensions added to plain pi, off by option or when pieces are missing", async () => {
	const { subagentArgs } = await import("./pi.mjs");
	const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const root = mkdtempSync(join(tmpdir(), "pi-sa-")), agent = mkdtempSync(join(tmpdir(), "pi-ag-"));
	assert.deepEqual(subagentArgs([], { PI_CODING_AGENT_DIR: agent }, root), [], "missing pieces: nothing");
	mkdirSync(join(agent, "optional-extensions", "subagent"), { recursive: true });
	writeFileSync(join(agent, "optional-extensions", "subagent", "index.ts"), "");
	mkdirSync(join(root, "pi-team"));
	mkdirSync(join(root, "extensions"));
	writeFileSync(join(root, "extensions", "tool-groups.ts"), "");
	const a = subagentArgs(["--model", "haiku"], { PI_CODING_AGENT_DIR: agent }, root);
	assert.equal(a.length, 6);
	assert.ok(a[5].endsWith("tool-groups.ts"), "tool-groups last");
	assert.deepEqual(subagentArgs([], { PI_CODING_AGENT_DIR: agent, PI_SUBAGENTS: "off" }, root), []);
	assert.deepEqual(subagentArgs(["install", "npm:x"], { PI_CODING_AGENT_DIR: agent }, root), []);
	assert.deepEqual(subagentArgs(["-e", "x"], { PI_CODING_AGENT_DIR: agent }, root), []);
});

test("pi doctor is ours: never handed to classic Pi, even without a TTY", () => {
	assert.equal(isClassic(["doctor"], {}, true), false);
	assert.equal(isClassic(["doctor", "--check"], {}, false), false);
});
