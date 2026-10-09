import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, markRunning, readTranscript } from "../sessions.mjs";

const line = (record) => `${JSON.stringify(record)}\n`;
function session(root, project, file, { cwd, created, title, name, extra = [] }) {
	const dir = join(root, project);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, file);
	writeFileSync(path, line({ type: "session", version: 3, id: file, timestamp: created, cwd }) + line({ type: "message", id: "s", message: { role: "system", content: "" } }) + line({ type: "message", id: "u", message: { role: "user", content: [{ type: "text", text: title }] } }) + (name ? line({ type: "session_info", id: "n", name }) : "") + extra.map(line).join(""));
	return path;
}

test("lists sessions newest first with project, title (or name) and dates", () => {
	const root = mkdtempSync(join(tmpdir(), "sessions-"));
	const a = session(root, "--p-shop--", "a.jsonl", { cwd: "/p/shop", created: "2026-10-01T10:00:00Z", title: "sistema il carrello" });
	const b = session(root, "--p-blog--", "b.jsonl", { cwd: "/p/blog", created: "2026-10-02T10:00:00Z", title: "scrivi un post", name: "Post di ottobre" });
	utimesSync(a, new Date("2026-10-05"), new Date("2026-10-05"));
	utimesSync(b, new Date("2026-10-03"), new Date("2026-10-03"));
	const list = listSessions(root);
	assert.deepEqual(list.map((item) => item.title), ["sistema il carrello", "Post di ottobre"]);
	assert.equal(list[0].cwd, "/p/shop");
	assert.equal(list[0].project, "shop");
	assert.equal(list[0].created, "2026-10-01T10:00:00Z");
});

test("a running pi is matched to the session of its folder written since it started", () => {
	const sessions = [
		{ path: "/s/old", cwd: "/p/shop", created: "2026-10-01T09:00:00Z", modified: Date.parse("2026-10-01T09:30:00Z") },
		{ path: "/s/now", cwd: "/p/shop", created: "2026-10-01T09:00:00Z", modified: Date.parse("2026-10-09T12:00:00Z") },
		{ path: "/s/blog", cwd: "/p/blog", created: "2026-10-09T11:00:00Z", modified: Date.parse("2026-10-09T11:05:00Z") },
	];
	const marked = markRunning(sessions, [
		{ pid: 10, cwd: "/p/shop", started: Date.parse("2026-10-09T09:00:00Z") },
		{ pid: 11, cwd: "/p/blog", started: Date.parse("2026-10-09T10:59:00Z") },
		{ pid: 12, cwd: "/p/other", started: 0 },
	], 11);
	assert.equal(marked.find((item) => item.path === "/s/now").running.pid, 10);
	assert.equal(marked.find((item) => item.path === "/s/old").running, undefined);
	assert.equal(marked.find((item) => item.path === "/s/blog").running.own, true);
});

test("transcript: user and assistant text, tool calls in brief, and only what was appended since an offset", () => {
	const root = mkdtempSync(join(tmpdir(), "sessions-"));
	const path = session(root, "--p--", "c.jsonl", {
		cwd: "/p",
		created: "2026-10-01T10:00:00Z",
		title: "leggi il README",
		extra: [{ type: "message", id: "a", message: { role: "assistant", content: [{ type: "text", text: "Lo leggo." }, { type: "toolCall", id: "t", name: "read", arguments: { path: "README.md" } }] } }, { type: "message", id: "r", message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "# Titolo" }] } }],
	});
	const first = readTranscript(path);
	assert.deepEqual(first.items.map((item) => [item.role, item.text]), [["user", "leggi il README"], ["assistant", "Lo leggo."], ["tool", "read README.md"]]);
	appendFileSync(path, line({ type: "message", id: "b", message: { role: "assistant", content: [{ type: "text", text: "Fatto." }] } }));
	const next = readTranscript(path, first.offset);
	assert.deepEqual(next.items.map((item) => item.text), ["Fatto."]);
});
