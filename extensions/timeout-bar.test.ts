import assert from "node:assert/strict";
import { test } from "node:test";
import timeoutBar, { levelColor, renderDeadline, shellSleepMs, shellTimeouts } from "./timeout-bar.ts";
import { C } from "./test-monitor/render.ts";

test("shellTimeouts reads timeout N with units, options and several in one line", () => {
	assert.deepEqual(shellTimeouts("timeout 30 npm test").map((entry) => entry.ms), [30_000]);
	assert.deepEqual(shellTimeouts("cd x && timeout -k 5 2m npm run build | tail").map((entry) => entry.ms), [120_000]);
	assert.deepEqual(shellTimeouts("timeout 10s a; timeout 1h b").map((entry) => entry.ms), [10_000, 3_600_000]);
	assert.equal(shellTimeouts("echo timeout 5").length, 0);
	assert.equal(shellTimeouts("npm test").length, 0);
});

test("levelColor warns at 75% and 90%", () => {
	assert.equal(levelColor(0.1), C.cyan);
	assert.equal(levelColor(0.8), C.warn);
	assert.equal(levelColor(0.95), C.err);
});

test("renderDeadline shows percent and clock, never past 100%, within the width", () => {
	const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
	const line = plain(renderDeadline({ key: "k", label: "bash timeout", startedAt: 0, timeoutMs: 30_000 }, 80, 15_000));
	assert.match(line, /50%/);
	assert.match(line, /15s \/ 30s/);
	assert.ok([...line].length <= 80);
	assert.match(plain(renderDeadline({ key: "k", label: "x", startedAt: 0, timeoutMs: 1000 }, 60, 99_000)), /100%/);
});

test("the bar follows a bash call and the team events, and goes away at the result", () => {
	const handlers = new Map<string, (event: any, ctx?: any) => unknown>();
	const bus = new Map<string, (data: unknown) => void>();
	let rendered: string[] = [];
	let tuiRenders = 0;
	timeoutBar({ on: (name: string, fn: any) => handlers.set(name, fn), events: { on: (name: string, fn: any) => bus.set(name, fn), emit() {} } } as never);
	handlers.get("session_start")?.({}, {
		hasUI: true,
		ui: { theme: { name: undefined }, setWidget: (_key: string, factory: any) => { rendered = []; const view = factory({ requestRender: () => tuiRenders++ }); (globalThis as any).__view = view; } },
	});
	return new Promise<void>((resolve) => setTimeout(() => {
		const view = (globalThis as any).__view;
		handlers.get("tool_call")?.({ toolName: "bash", toolCallId: "t1", input: { command: "timeout 20 sleep 5", timeout: 60 } });
		assert.equal(view.render(80).length, 2);
		handlers.get("tool_call")?.({ toolName: "read", toolCallId: "t2", input: {} });
		assert.equal(view.render(80).length, 2);
		bus.get("timeout-bar:set")?.({ key: "team:a1", label: "a1 dev", startedAt: Date.now(), timeoutMs: 1_200_000 });
		assert.equal(view.render(80).length, 3);
		handlers.get("tool_result")?.({ toolCallId: "t1" });
		assert.equal(view.render(80).length, 1);
		bus.get("timeout-bar:clear")?.({ prefix: "team:" });
		assert.equal(view.render(80).length, 0);
		assert.ok(tuiRenders > 0);
		handlers.get("session_shutdown")?.({});
		resolve();
	}, 50));
});

test("shellSleepMs sums sleep calls with units and ignores look-alikes", () => {
	assert.equal(shellSleepMs("sleep 270; tail x"), 270_000);
	assert.equal(shellSleepMs("cd x && sleep 1m 30s"), 90_000);
	assert.equal(shellSleepMs("sleep 5 && echo a; sleep 2.5"), 7_500);
	assert.equal(shellSleepMs("echo sleep 5"), 0);
	assert.equal(shellSleepMs("npm test"), 0);
});

test("watchedFile: the file tail reads after a sleep, or the redirect of a background run, following cd", async () => {
	const { watchedFile, watchLines } = await import("./timeout-bar.ts");
	assert.equal(watchedFile("sleep 60; tail -30 /tmp/ui3/studio-check.log | cut -c1-200; pgrep -f x | head -2", "/w"), "/tmp/ui3/studio-check.log");
	assert.equal(watchedFile("cd /p/e2e; (setsid nohup timeout 280 npx vitest run a > /tmp/i5.log 2>&1 < /dev/null &); sleep 200", "/w"), "/tmp/i5.log");
	assert.equal(watchedFile("cd /p; (nohup run > out.log 2>&1 &); sleep 5", "/w"), "/p/out.log");
	assert.equal(watchedFile("sleep 5; echo done", "/w"), undefined);
	const lines = watchLines("/tmp/definitely-missing-file.log", 80, Date.now());
	assert.match(lines[0], /not created yet/);
});
