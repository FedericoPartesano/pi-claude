import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("a git install pinned to a ref (pi install git:...@v0.3.0) keeps its ref", () => {
	const pinned = "git:github.com/FedericoPartesano/pi-claude@v0.3.0";
	const after = migrateSettings({ packages: [pinned] }, { source: "git:github.com/FedericoPartesano/pi-claude" });
	assert.deepEqual(after.packages, [pinned]);
});

test("an install by https URL is recognised as this package (no second entry, which loaded every extension twice)", () => {
	for (const form of ["https://github.com/FedericoPartesano/pi-claude.git", "https://github.com/FedericoPartesano/pi-claude", "git:github.com/FedericoPartesano/pi-claude@v0.3.0"]) {
		const after = migrateSettings({ packages: [form] }, { source: "git:github.com/FedericoPartesano/pi-claude" });
		assert.deepEqual(after.packages, [form], form);
	}
});

test("PowerShell profile block starts bin/pi.mjs", async () => {
	const { powerShellBlock } = await import("./setup.mjs");
	const block = powerShellBlock("C:\\repo");
	assert.match(block, /function pi \{ node ".*pi\.mjs" @args \}/);
});

test("context compression: billion-context-pi pinned once, older versions replaced, a disabled entry stays disabled", async () => {
	const { applyContextCompression, BILLION_CONTEXT } = await import("./setup.mjs");
	assert.match(BILLION_CONTEXT, /^npm:billion-context-pi@\d+\.\d+\.\d+$/);
	const fresh = applyContextCompression({ packages: ["/home/u/pi-claude"] });
	assert.deepEqual(fresh.packages, ["/home/u/pi-claude", BILLION_CONTEXT]);
	assert.deepEqual(applyContextCompression(fresh), fresh, "idempotent");
	const old = applyContextCompression({ packages: ["npm:billion-context-pi@0.1.40", "npm:billion-context-pi"] });
	assert.deepEqual(old.packages, [BILLION_CONTEXT]);
	const off = applyContextCompression({ packages: [{ source: "npm:billion-context-pi@0.1.40", extensions: [] }] });
	assert.deepEqual(off.packages, [{ source: BILLION_CONTEXT, extensions: [] }]);
});

test("acp.json defaults: lean profile, no self-update, no delegate tools, user choices kept key by key", async () => {
	const { applyAcpDefaults } = await import("./setup.mjs");
	const profile = { $comment: "x", autoUpdate: false, delegate: false, promptSections: { tools: null, tier2: null }, nudgeSections: { t2Guidance: "T2" } };
	assert.deepEqual(applyAcpDefaults({}, profile), { autoUpdate: false, delegate: false, promptSections: { tools: null, tier2: null }, nudgeSections: { t2Guidance: "T2" } });
	const mine = applyAcpDefaults({ delegate: true, debug: true, promptSections: { tools: "my tools" } }, profile);
	assert.deepEqual(mine, { delegate: true, debug: true, autoUpdate: false, promptSections: { tier2: null, tools: "my tools" }, nudgeSections: { t2Guidance: "T2" } });
	assert.deepEqual(applyAcpDefaults(mine, profile), mine, "idempotent");
});

test("acp.json defaults: arrays are values, not maps (kept as the user wrote them; a list turned into {\"0\":…} by older versions is repaired)", async () => {
	const { applyAcpDefaults } = await import("./setup.mjs");
	const profile = { preserveRecentTools: ["read"] };
	assert.deepEqual(applyAcpDefaults({ preserveRecentTools: ["read"] }, profile), { preserveRecentTools: ["read"] });
	assert.deepEqual(applyAcpDefaults({ preserveRecentTools: ["bash", "read"] }, profile), { preserveRecentTools: ["bash", "read"] });
	assert.deepEqual(applyAcpDefaults({ preserveRecentTools: [] }, profile), { preserveRecentTools: [] });
	assert.deepEqual(applyAcpDefaults({ preserveRecentTools: { 0: "read" } }, profile), { preserveRecentTools: ["read"] });
	assert.deepEqual(applyAcpDefaults({}, profile), { preserveRecentTools: ["read"] });
});

test("the shipped profile pins the same billion-context-pi version, moves tier rules to nudges, keeps recall and compress rules short", async () => {
	const { BILLION_CONTEXT } = await import("./setup.mjs");
	const profile = JSON.parse(readFileSync(new URL("./acp-profile.json", import.meta.url), "utf8"));
	assert.ok(profile.$comment.includes(BILLION_CONTEXT.replace(/^npm:/, "")));
	const sections = profile.promptSections;
	for (const key of ["tools", "tier2", "tier3", "throttleRetry", "contextBreakdown"]) assert.equal(sections[key], null, key);
	assert.match(sections.howToCompress, /^HOW TO COMPRESS/);
	assert.ok(sections.howToCompress.length < 1500, "short compress rules");
	// Haiku closed the range objects as "]}" and resent the same JSON 4 times (long chat G-v).
	assert.match(sections.howToCompress, /close each object with \} before \]/);
	assert.match(sections.decompressPhilosophy, /search_context/);
	assert.match(profile.nudgeSections.t2Guidance, /TIER 2 COMPRESSION — DISTILLATION/);
	assert.match(profile.nudgeSections.t3Guidance, /TIER 3 COMPRESSION — ULTRA-CONDENSATION/);
	// Measured on the 29-turn long chat: few large folds instead of one per turn (eval/fold/REPORT.md).
	assert.deepEqual(profile.compress, { minPressureBenefitTokens: 30000 });
	assert.equal(profile.modelContextLimit, 100000);
});
