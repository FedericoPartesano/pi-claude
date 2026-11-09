import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentFeed } from "../src/feed.ts";
import { renderTeamLog, STALL_SECONDS, TeamLog } from "../src/view/side-log.ts";
import type { ViewTheme } from "../src/view/widgets.ts";

const plain: ViewTheme = { fg: (_role, text) => text, bg: (_role, text) => text, bold: (text) => text, italic: (text) => text };
const begin = (feed: AgentFeed, id: string, startedAt = 1000) => feed.begin({ key: `${id}#1`, id, title: id, role: "implementer", model: "sonnet", attempt: 1, startedAt });
const tool = (feed: AgentFeed, id: string, path: string) => feed.event(`${id}#1`, { type: "tool_execution_start", toolName: "read", args: { path } });

test("renderTeamLog: one block per agent, newest lines kept, every row within the width and height", () => {
	const feed = new AgentFeed();
	begin(feed, "t1");
	begin(feed, "t2");
	for (let i = 0; i < 20; i++) tool(feed, "t1", `src/file-${i}.ts`);
	tool(feed, "t2", "src/other.ts");
	const lines = renderTeamLog(plain, feed.agents, 50, 16, Date.now(), 0);
	assert.ok(lines.length <= 16);
	assert.ok(lines.every((line) => visibleWidth(line) <= 50));
	const text = lines.join("\n");
	assert.match(text, /TEAM 2 al lavoro/);
	assert.match(text, /file-19\.ts/);
	assert.doesNotMatch(text, /file-0\.ts/);
	assert.match(text, /other\.ts/);
});

test("renderTeamLog: an agent silent for a while is shown as stalled; finished ones get one line", () => {
	const feed = new AgentFeed();
	begin(feed, "t1", 0);
	begin(feed, "t2", 0);
	feed.end("t2#1", { ok: true, seconds: 5, inputTokens: 100, outputTokens: 10 });
	const now = feed.get("t1#1")!.lastActivity + (STALL_SECONDS + 5) * 1000;
	const text = renderTeamLog(plain, feed.agents, 60, 12, now, 0).join("\n");
	assert.match(text, /fermo da/);
	assert.match(text, /✓ t2/);
	assert.match(text, /1 al lavoro · 1 finiti/);
});

test("TeamLog opens when an agent starts, lingers after the last one ends, then closes; the strip is the fallback", async () => {
	const feed = new AgentFeed();
	const calls: Array<[string, boolean]> = [];
	const log = new TeamLog(feed, () => 30);
	log.attach({ theme: plain, setWidget: (key, content) => calls.push([key, content !== undefined]) });
	assert.deepEqual(calls, []);
	begin(feed, "t1");
	assert.deepEqual(calls, [["team-log", true]]);
	feed.end("t1#1", { ok: true, seconds: 1, inputTokens: 1, outputTokens: 1 });
	assert.deepEqual(calls, [["team-log", true]]);
	log.close();
	assert.deepEqual(calls, [["team-log", true], ["team-log", false]]);
	assert.equal(log.toggle(), true);
	assert.equal(log.toggle(), false);
	log.dispose();
});

test("TeamLog uses pi-ui's side column when there is one", () => {
	const events: string[] = [];
	(globalThis as any)[Symbol.for("pi-claude/side-column")] = {
		available: () => true,
		isOpen: () => false,
		open: (component: any, options: any) => events.push(`open ${options.width} ${component.render(60).length > 0}`),
		close: () => events.push("close"),
		redraw: () => events.push("redraw"),
	};
	try {
		const feed = new AgentFeed();
		const log = new TeamLog(feed, () => 30);
		log.attach({ theme: plain, setWidget: () => events.push("widget") });
		begin(feed, "t1");
		assert.equal(events[0], "open 60 true");
		assert.ok(!events.includes("widget"));
		log.close();
		assert.ok(events.includes("close"));
		log.dispose();
	} finally {
		delete (globalThis as any)[Symbol.for("pi-claude/side-column")];
	}
});

test("TeamLog in RPC mode: plain string lines at panel width, sent only when they change, no per-frame timer work", () => {
	const feed = new AgentFeed();
	const calls: { key: string; content: unknown }[] = [];
	const ui = { theme: plain, setWidget: (key: string, content: unknown) => calls.push({ key, content }) };
	const log = new TeamLog(feed, () => 30);
	log.attach(ui, "rpc");
	begin(feed, "t1", Date.now());
	assert.equal(calls.length, 1);
	const lines = calls[0].content as string[];
	assert.ok(Array.isArray(lines));
	assert.ok(lines.every((line) => visibleWidth(line) <= 33));
	assert.match(lines.join("\n").replace(/\x1b\[[0-9;]*m/g, ""), /TEAM 1 al lavoro/);
	log.attach(ui, "rpc"); // no change in the feed: nothing is sent again
	assert.equal(calls.length, 1);
	tool(feed, "t1", "src/a.ts");
	assert.equal(calls.length, 2);
	assert.match((calls[1].content as string[]).join("\n"), /a\.ts/);
	log.dispose();
	assert.equal(calls.at(-1)!.content, undefined);
});
