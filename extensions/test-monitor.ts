/**
 * test-monitor: a live panel above the editor (not in the chat) while a test command runs: one dot per test, grey until
 * its result arrives, then green or red, with counters and the clock. Runners are adapters in test-monitor/runners.ts
 * (node:test, jest, vitest, pytest, `npm test`); the progress is read while the command runs, from a `| tee` file, a
 * reporter file or the tool's partial output. The model still gets exactly the output it asked for.
 * PI_TEST_MONITOR=0 or PI_UI_LIVE=0 turn it off; it stays off on Windows native (no `tee`, other quoting).
 */
import { setWidgetCompat } from "./widget-compat.ts";
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { redirectedLog, teeBeforeFilter } from "./test-monitor/progress.ts";
import { newTestRun, renderTestMonitor, useColors, type Colors, type TestRun } from "./test-monitor/render.ts";
import { detectMonitor, type Monitor } from "./test-monitor/monitors.ts";
import { detectRunner, flattenCommand, prepareLines, type Runner } from "./test-monitor/runners.ts";
import { renderView, type ViewState } from "./test-monitor/views.ts";

interface Tracked {
	/** Test runner, or (other commands) the monitor that reads the tool's partial output into a view. */
	runner?: Runner;
	monitor?: Monitor;
	/** File the progress is read from, if any (tee file or reporter file). */
	log?: string;
	helpers: string[];
	/** The file is the user's own (`> out.log`): read it, never delete it. */
	external?: boolean;
}

const resultText = (result: unknown) =>
	((result as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");

/** The end of a file (at most `bytes`): long runs write megabytes, the latest results are enough to count... up to a cap. */
function readTail(file: string, bytes = 400_000): string {
	try {
		const size = statSync(file).size;
		const fd = openSync(file, "r");
		try {
			const buffer = Buffer.alloc(Math.min(size, bytes));
			readSync(fd, buffer, 0, buffer.length, Math.max(0, size - bytes));
			return buffer.toString("utf8");
		} finally {
			closeSync(fd);
		}
	} catch {
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	if (process.platform === "win32" || process.env.PI_TEST_MONITOR === "0" || process.env.PI_UI_LIVE === "0") return;
	const root = join(tmpdir(), `pi-test-monitor-${process.pid}`);
	const tracked = new Map<string, Tracked>();
	let run: TestRun | undefined;
	let runId: string | undefined;
	let runner: Runner | undefined;
	/** The panel for a command that is not a test run (type check, lint, build, install, git, docker). */
	let other: { view: ViewState; monitor: Monitor } | undefined;
	let tui: { requestRender(): void } | undefined;
	let hide: ReturnType<typeof setTimeout> | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let frame = 0;

	/** Newer parse wins unless it lost results (a rolling tail can drop old lines). */
	const apply = (text: string) => {
		if (!run || !runner) return;
		const parsed = runner.parse(text);
		if (parsed.results.length >= run.results.length) Object.assign(run, parsed);
	};
	const poll = () => {
		const log = runId ? tracked.get(runId)?.log : undefined;
		const item = runId ? tracked.get(runId) : undefined;
		// A user's file from an earlier run is stale until the shell truncates it.
		const stale = item?.external && log && run && (() => { try { return statSync(log).mtimeMs < run.startedAt - 100; } catch { return true; } })();
		if (run && !run.endedAt && log && !stale) apply(readTail(log));
		frame++;
		tui?.requestRender();
	};
	/** The command ended: stop polling, keep the verdict for a while, then clear the panel. */
	const finishPanel = (clear: () => void, ms: number) => {
		if (timer) (clearInterval(timer), (timer = undefined));
		clearTimeout(hide);
		hide = setTimeout(() => {
			clear();
			tui?.requestRender();
		}, ms);
		hide.unref?.();
		tui?.requestRender();
	};
	const cleanup = (id: string) => {
		const item = tracked.get(id);
		tracked.delete(id);
		if (!item) return;
		for (const file of [item.external ? undefined : item.log, ...item.helpers]) {
			if (file) rmSync(file, { force: true });
		}
	};

	/** pi-ui's palette follows the theme; inside Pi it can be imported, elsewhere (tests, CI) the defaults stay. */
	const loadPalette = async (theme: string | undefined) => {
		try {
			const palette = (await import("../pi-ui/src/palette.ts")) as { usePalette(name: string | undefined): boolean; C: Colors };
			palette.usePalette(theme);
			useColors(palette.C);
		} catch {}
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		void loadPalette(ctx.ui.theme?.name);
		setWidgetCompat(
			ctx as never,
			"test-monitor",
			() => ({ render: (width: number) => (other ? renderView(other.view, width, Date.now(), frame) : run ? renderTestMonitor(run, width, Date.now(), frame, width <= 36) : []), invalidate() {} }),
			{ placement: "aboveEditor" },
			(widgetTui) => {
				tui = widgetTui;
			},
		);
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const input = event.input as { command?: unknown };
		const original = String(input.command ?? "");
		const found = detectRunner(original);
		const id = String(event.toolCallId);
		if (!found) {
			// Not a test run: type check, lint, build, install, git, docker. The command is never rewritten.
			const monitor = detectMonitor(original);
			if (!monitor) return undefined;
			clearTimeout(hide);
			void loadPalette(ctx.ui?.theme?.name);
			run = undefined;
			other = { view: monitor.init(original, Date.now()), monitor };
			tracked.set(id, { monitor, helpers: [] });
			runId = id;
			timer ??= setInterval(poll, 250);
			timer.unref?.();
			return undefined;
		}
		const key = id.replace(/\W/g, "").slice(0, 24);
		const log = join(root, `${key}.log`);
		let command = original;
		const helpers: string[] = [];
		try {
			mkdirSync(root, { recursive: true });
			const prepared = prepareLines(found, command, { log, helper: join(root, key), cwd: ctx.cwd });
			if (prepared) {
				command = prepared.command;
				for (const [file, content] of Object.entries(prepared.files ?? {})) {
					mkdirSync(dirname(file), { recursive: true });
					writeFileSync(file, content);
					helpers.push(file);
				}
			}
			let source: string | undefined;
			let external = false;
			if (found.source === "reporter" && helpers.length) source = log;
			else if (found.source === "output") {
				const teed = teeBeforeFilter(command, log);
				if (teed) {
					command = teed;
					source = log;
				} else {
					// `… > /tmp/x.log 2>&1; grep …`: the tool prints nothing live, the file the run writes to is the signal.
					const written = redirectedLog(flattenCommand(original), ctx.cwd, (stage) => found.matches(stage));
					if (written) {
						source = written;
						external = true;
					}
				}
			}
			input.command = command;
			tracked.set(id, { runner: found, log: source, helpers, external });
		} catch {
			return undefined;
		}
		clearTimeout(hide);
		void loadPalette(ctx.ui?.theme?.name);
		other = undefined;
		run = newTestRun(original, Date.now());
		run.total = found.estimate(original, ctx.cwd);
		runId = id;
		runner = found;
		timer ??= setInterval(poll, 250);
		timer.unref?.();
		return undefined;
	});

	pi.on("tool_execution_update", (event) => {
		const item = tracked.get(String(event.toolCallId));
		// Without a file the tool's own partial output is the only source.
		if (item?.monitor && other && runId === event.toolCallId) item.monitor.update(other.view, resultText(event.partialResult));
		else if (item && !item.log && runId === event.toolCallId) apply(resultText(event.partialResult));
	});

	pi.on("tool_execution_end", (event) => {
		const id = String(event.toolCallId);
		const item = tracked.get(id);
		if (!item) return;
		if (item.monitor && other && runId === id && other.view.kind !== "tests" && !other.view.endedAt) {
			item.monitor.update(other.view, resultText(event.result));
			other.view.endedAt = Date.now();
			other.view.failed = Boolean((event as { isError?: boolean }).isError);
			finishPanel(() => (other = undefined), other.view.failed ? 30_000 : 8_000);
		} else if (run && runId === id && !run.endedAt) {
			apply(item.log ? readTail(item.log) : resultText(event.result));
			run.endedAt = Date.now();
			finishPanel(() => (run = undefined), run.fail ? 30_000 : 8_000);
		}
		cleanup(id);
	});

	pi.on("session_shutdown", () => {
		clearTimeout(hide);
		if (timer) clearInterval(timer);
		rmSync(root, { recursive: true, force: true });
	});
}
