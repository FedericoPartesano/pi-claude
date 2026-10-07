import { test } from "node:test";
import assert from "node:assert/strict";
import { activeToolsFor, mergeActiveTools, parseGroups } from "./tool-groups.ts";

const ALL = ["read", "bash", "edit", "write", "web_search", "fetch_content", "todo", "team", "load_tools"];

test("hides the tools of groups that are not loaded", () => {
	assert.deepEqual(activeToolsFor(ALL, new Set()), ["read", "bash", "edit", "write", "load_tools"]);
});

test("keeps the tools of loaded groups", () => {
	assert.deepEqual(activeToolsFor(ALL, new Set(["web", "team"])), ["read", "bash", "edit", "write", "web_search", "fetch_content", "team", "load_tools"]);
});

test("ignores group tools that are not registered", () => {
	assert.deepEqual(activeToolsFor(["read", "load_tools"], new Set(["web"])), ["read", "load_tools"]);
});

test("parses group lists", () => {
	assert.deepEqual(parseGroups("web, team"), { groups: ["web", "team"], unknown: [] });
	assert.deepEqual(parseGroups("all"), { groups: ["web", "todo", "subagent", "team"], unknown: [] });
	assert.deepEqual(parseGroups("web foo"), { groups: ["web"], unknown: ["foo"] });
	assert.deepEqual(parseGroups(undefined), { groups: [], unknown: [] });
});

test("only touches managed tools: tools other extensions turned on later stay on", () => {
	// goal_done was activated after the first apply; loading web must not turn it off.
	const current = ["read", "bash", "load_tools", "goal_done"];
	const managedBaseline = ["web_search", "fetch_content", "todo", "team"];
	assert.deepEqual(mergeActiveTools(current, managedBaseline, new Set(["web"])), ["read", "bash", "load_tools", "goal_done", "web_search", "fetch_content"]);
});

test("respects managed tools excluded at startup (--exclude-tools)", () => {
	assert.deepEqual(mergeActiveTools(["read"], ["fetch_content"], new Set(["web"])), ["read", "fetch_content"]);
});
