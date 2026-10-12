import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentFeed, MAX_ENTRIES } from "../src/feed.ts";
import { AgentsView, gridLayout, orderAgents } from "../src/view/agents-view.ts";
import { frame, segmentBar, sparkline, type ViewTheme } from "../src/view/widgets.ts";

const plain: ViewTheme = { fg: (_role, text) => text, bg: (_role, text) => text, bold: (text) => text, italic: (text) => text };
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

function feedWithAgents(count: number) {
	const feed = new AgentFeed();
	for (let index = 1; index <= count; index++) feed.begin({ key: `p${index}#${index}`, id: `p${index}`, title: `Compito ${index}`, role: "implementer", model: "sonnet", attempt: 1, startedAt: 1000 });
	return feed;
}

test("feed: streamed thinking/text, tools with results, usage per request", () => {
	const feed = feedWithAgents(1);
	const key = "p1#1";
	feed.event(key, { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
	feed.event(key, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Leggo " } });
	feed.event(key, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "i file" } });
	feed.event(key, { type: "tool_execution_start", toolName: "read", args: { path: "src/a.ts" } });
	assert.equal(feed.get(key)!.currentTool, "read src/a.ts");
	feed.event(key, { type: "tool_execution_end", toolName: "read", result: { content: [{ type: "text", text: "export const a = 1;" }] }, isError: false });
	feed.event(key, { type: "message_end", message: { role: "assistant", usage: { input: 10, cacheRead: 990, cacheWrite: 0, output: 50 } } });
	feed.event(key, { type: "message_end", message: { role: "assistant", usage: { input: 5, cacheRead: 1495, output: 20 } } });
	const agent = feed.get(key)!;
	assert.deepEqual(agent.entries.map((entry) => [entry.kind, entry.text]), [["thinking", "Leggo i file"], ["tool", "src/a.ts"], ["result", "export const a = 1;"]]);
	assert.equal(agent.currentTool, undefined);
	assert.deepEqual(agent.requestTokens, [1000, 1500]);
	assert.equal(agent.outputTokens, 70);
	assert.deepEqual(agent.toolCounts, { read: 1 });
	feed.end(key, { ok: true, seconds: 12, inputTokens: 2500, outputTokens: 70 });
	assert.equal(agent.state, "done");
	assert.equal(feed.running, 0);
});

test("feed: bounded, ignores unknown agents and events", () => {
	const feed = feedWithAgents(1);
	for (let index = 0; index < MAX_ENTRIES + 30; index++) feed.event("p1#1", { type: "tool_execution_start", toolName: "bash", args: { command: `echo ${index}` } });
	assert.equal(feed.get("p1#1")!.entries.length, MAX_ENTRIES);
	assert.doesNotThrow(() => feed.event("nobody", { type: "tool_execution_start" }));
	assert.doesNotThrow(() => feed.event("p1#1", null));
	assert.doesNotThrow(() => feed.event("p1#1", { type: "agent_start" }));
});

test("order: running first, then finished most recent first", () => {
	const feed = feedWithAgents(3);
	feed.end("p1#1", { ok: true, seconds: 1, inputTokens: 0, outputTokens: 0 });
	feed.end("p2#2", { ok: false, seconds: 1, inputTokens: 0, outputTokens: 0 });
	assert.deepEqual(orderAgents(feed.agents).map((agent) => agent.id), ["p3", "p2", "p1"]);
});

test("layout: columns that fit, a second row only with room", () => {
	assert.deepEqual(gridLayout(3, 200, 30), { columns: 3, rows: 1, cardWidth: 66, cardHeight: 30 });
	assert.equal(gridLayout(8, 120, 40).columns, 3);
	assert.equal(gridLayout(8, 120, 40).rows, 2);
	assert.equal(gridLayout(8, 120, 20).rows, 1);
	assert.equal(gridLayout(1, 30, 20).columns, 1);
});

test("widgets: frame is exactly width × height, bars and sparklines fit", () => {
	const card = frame(plain, ["una riga molto lunga che va tagliata".repeat(4), "b"], 30, 6, { title: "titolo", badge: "3s", color: "border" });
	assert.equal(card.length, 6);
	for (const line of card) assert.equal(visibleWidth(line), 30);
	assert.equal(visibleWidth(segmentBar(plain, [{ role: "accent", char: "▰" }, { role: "success", char: "▰" }], 17)), 17);
	assert.equal(sparkline([1, 5, 10], 10), "▁▄█");
});

for (const [width, count] of [[60, 0], [80, 1], [140, 3], [200, 9], [100, 5]] as const) {
	test(`view: every line fits ${width} columns with ${count} agents, grid and zoom`, () => {
		const feed = feedWithAgents(count);
		if (count > 0) {
			feed.event("p1#1", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "penso ".repeat(80) } });
			feed.event("p1#1", { type: "tool_execution_start", toolName: "bash", args: { command: "npm test -- --watch=false ".repeat(5) } });
			feed.event("p1#1", { type: "tool_execution_end", toolName: "bash", result: { content: [{ type: "text", text: "riga\n".repeat(30) + "x".repeat(400) } ] }, isError: true });
			feed.event("p1#1", { type: "message_end", message: { role: "assistant", usage: { input: 1200, output: 300 } } });
		}
		let closed = false;
		const view = new AgentsView(feed, plain, () => (closed = true), () => {}, () => 30, () => 61_000);
		try {
			for (const zoom of [false, true]) {
				const lines = view.render(width);
				assert.equal(lines.length, 30);
				for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${strip(line)}`);
				if (count === 0) assert.ok(lines.some((line) => line.includes("Nessun agente al lavoro")));
				else assert.ok(lines.some((line) => line.includes("p1")));
				if (!zoom) view.handleInput("\r");
			}
			view.handleInput("\x1b");
			assert.equal(closed, false, "first Esc leaves the zoom");
			view.handleInput("\x1b");
			assert.equal(closed, true);
		} finally {
			view.dispose();
		}
	});
}

test("view: selection follows the agent, zoom shows the stats panel", () => {
	const feed = feedWithAgents(3);
	feed.event("p2#2", { type: "tool_execution_start", toolName: "grep", args: { pattern: "TODO" } });
	const view = new AgentsView(feed, plain, () => {}, () => {}, () => 30, () => 5000);
	try {
		view.handleInput("\x1b[C");
		view.handleInput("\r");
		const zoomed = view.render(160).join("\n");
		assert.match(zoomed, /p2/);
		assert.match(zoomed, /STRUMENTI/);
		assert.match(zoomed, /grep/);
	} finally {
		view.dispose();
	}
});
