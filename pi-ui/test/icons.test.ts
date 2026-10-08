import { test } from "node:test";
import assert from "node:assert/strict";
import { I, iconSetFor, toolIcon, useIcons, verbFor, withIcon } from "../src/icons.ts";

test("Nerd icons on WezTerm (also in tmux), plain elsewhere, PI_UI_ICONS wins", () => {
	assert.equal(iconSetFor({ WEZTERM_PANE: "3" }), "nerd");
	assert.equal(iconSetFor({ TERM_PROGRAM: "WezTerm" }), "nerd");
	assert.equal(iconSetFor({ TERM_PROGRAM: "vscode" }), "plain");
	assert.equal(iconSetFor({ WEZTERM_PANE: "3", PI_UI_ICONS: "plain" }), "plain");
	assert.equal(iconSetFor({ PI_UI_ICONS: "nerd" }), "nerd");
});

test("each tool has an icon in the Nerd set and none in the plain one; HUD verbs", () => {
	useIcons("nerd");
	for (const tool of ["read", "edit", "write", "bash", "grep", "ls", "subagent", "fetch_content", "something"]) assert.ok(toolIcon(tool), tool);
	assert.notEqual(toolIcon("read"), toolIcon("bash"));
	assert.equal(withIcon(I.branch, "main"), `${I.branch} main`);
	useIcons("plain");
	assert.equal(toolIcon("read"), "");
	assert.equal(withIcon(I.read, "x"), "x", "no gap without an icon");
	assert.equal(I.branch, "⎇");
	assert.equal(verbFor("edit"), "PATCH");
	assert.equal(verbFor("bash"), "EXEC");
	assert.equal(verbFor("mcp"), "MCP");
});
