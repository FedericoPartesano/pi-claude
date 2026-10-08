import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDefaults, applyKeybindings, migrateSettings } from "./setup.mjs";

test("defaults fill only what the user has not chosen", () => {
	const s = applyDefaults({ defaultModel: "opus", compaction: { enabled: true } });
	assert.equal(s.defaultModel, "opus");
	assert.equal(s.defaultProvider, "claude-code");
	assert.equal(s.theme, "neon-night");
	assert.deepEqual(s.compaction, { enabled: true, reserveTokens: 80000 });
	assert.equal(s.hideThinkingBlock, true);
});

test("Ctrl+V and Alt+V paste images, unless the user bound the action already", () => {
	assert.deepEqual(applyKeybindings({})["app.clipboard.pasteImage"], ["alt+v", "ctrl+v"]);
	assert.equal(applyKeybindings({ "app.clipboard.pasteImage": "f5" })["app.clipboard.pasteImage"], "f5");
});

test("migration: the old per-file registrations of this repo give way to one package entry", () => {
	const repo = "/home/u/pi-claude";
	const before = {
		packages: ["../../pi-claude/pi-claude-code", { source: "npm:pi-web-access@0.31.0", extensions: [] }, "../../pi-claude/pi-picker", "../../pi-claude/pi-ui"],
		extensions: [`${repo}/extensions/intent.ts`, `${repo}/extensions/memory.ts`, "/other/mine.ts"],
	};
	const after = migrateSettings(before, { repo, source: repo, agentDir: "/home/u/.pi/agent" });
	assert.deepEqual(after.extensions, ["/other/mine.ts"]);
	assert.deepEqual(after.packages, [{ source: "npm:pi-web-access@0.31.0", extensions: [] }, repo]);
	assert.deepEqual(migrateSettings(after, { repo, source: repo, agentDir: "/home/u/.pi/agent" }), after, "idempotent");
});

test("migration with the git source: the package entry is the git one, local paths of the repo go", () => {
	const repo = "/home/u/.pi/agent/git/github.com/FedericoPartesano/pi-claude";
	const source = "git:github.com/FedericoPartesano/pi-claude";
	const after = migrateSettings({ packages: [source, "../../old/pi-claude/pi-ui"] }, { repo, source, agentDir: "/home/u/.pi/agent" });
	assert.deepEqual(after.packages, [source]);
});
