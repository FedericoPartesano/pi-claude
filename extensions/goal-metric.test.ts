import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginMetric, improves, metricLines, parseMetricValue, settleRound, type MetricState } from "./goal-metric.ts";
import { parseGoalArgs } from "./goal.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "goal-metric-"));
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "t@t");
	git(dir, "config", "user.name", "t");
	writeFileSync(join(dir, "size.txt"), "10\n");
	git(dir, "add", ".");
	git(dir, "commit", "-qm", "init");
	return dir;
}

test("reads the metric as the last number the command prints", () => {
	assert.equal(parseMetricValue("bundle: 1234 bytes\n"), 1234);
	assert.equal(parseMetricValue("p50 3.5 ms\np95 12,25 ms"), 12.25);
	assert.equal(parseMetricValue("score=-0.5"), -0.5);
	assert.equal(parseMetricValue("no numbers here"), undefined);
});

test("improves follows the direction and ignores ties", () => {
	assert.ok(improves(9, 10, "lower"));
	assert.ok(!improves(10, 10, "lower"));
	assert.ok(improves(11, 10, "higher"));
	assert.ok(improves(5, undefined, "lower"));
});

test("parses --metric, --higher and --target", () => {
	assert.deepEqual(parseGoalArgs(`--metric "wc -c < dist/app.js" --target 5000 riduci il bundle`), {
		action: "start",
		text: "riduci il bundle",
		checks: [],
		max: undefined,
		metric: { command: "wc -c < dist/app.js", direction: "lower", target: 5000 },
	});
	assert.equal(parseGoalArgs(`--metric "node bench.js" --higher alza il throughput`).action === "start" && (parseGoalArgs(`--metric "node bench.js" --higher x`) as { metric?: { direction: string } }).metric?.direction, "higher");
	assert.equal(parseGoalArgs("--target 3 x").action, "error"); // --target without --metric
});

test("refuses a dirty tree, then works on its own branch from a measured baseline", async () => {
	const dir = repo();
	writeFileSync(join(dir, "size.txt"), "11\n");
	const dirty = await beginMetric(dir, { command: "cat size.txt", direction: "lower" }, "riduci");
	assert.equal(dirty.ok, false);
	git(dir, "checkout", "-q", "--", "size.txt");
	const started = await beginMetric(dir, { command: "cat size.txt", direction: "lower" }, "riduci la taglia");
	assert.ok(started.ok);
	if (!started.ok) return;
	assert.equal(started.state.baseline, 10);
	assert.equal(started.state.best, 10);
	assert.match(git(dir, "branch", "--show-current"), /^goal\/metric-riduci-la-taglia/);
});

test("a better round is committed, a worse one is stashed (recoverable), a broken metric is stashed too", async () => {
	const dir = repo();
	const started = await beginMetric(dir, { command: "cat size.txt", direction: "lower" }, "riduci");
	assert.ok(started.ok);
	if (!started.ok) return;
	const state: MetricState = started.state;

	writeFileSync(join(dir, "size.txt"), "8\n");
	const better = await settleRound(dir, state, 1);
	assert.equal(better.kept, true);
	assert.equal(state.best, 8);
	assert.match(git(dir, "log", "-1", "--format=%s"), /10 → 8/);

	writeFileSync(join(dir, "size.txt"), "9\n");
	writeFileSync(join(dir, "new.txt"), "x");
	const worse = await settleRound(dir, state, 2);
	assert.equal(worse.kept, false);
	assert.equal(readFileSync(join(dir, "size.txt"), "utf8"), "8\n");
	assert.equal(git(dir, "status", "--porcelain"), "");
	assert.match(git(dir, "stash", "list"), /goal-metric giro 2/);

	writeFileSync(join(dir, "size.txt"), "nulla\n");
	const broken = await settleRound(dir, state, 3);
	assert.equal(broken.kept, false);
	assert.match(broken.line, /senza numero|fallisce/);
	assert.equal(state.best, 8);

	const idle = await settleRound(dir, state, 4); // nothing changed: nothing to measure
	assert.equal(idle.kept, false);
	assert.match(idle.line, /nessuna modifica/);
	assert.equal(state.history.length, 4);
});

test("the reminder carries the history, so the model knows what worked", () => {
	const lines = metricLines({ command: "cat size.txt", direction: "lower", branch: "goal/metric-x", baseline: 10, best: 8, history: [{ round: 1, value: 8, kept: true }, { round: 2, value: 9, kept: false }] });
	assert.match(lines, /10 → migliore 8/);
	assert.match(lines, /giro 2: 9 · scartato/);
	assert.match(lines, /più basso/);
});

test("reaching the target is reported", async () => {
	const dir = repo();
	const started = await beginMetric(dir, { command: "cat size.txt", direction: "lower", target: 5 }, "x");
	assert.ok(started.ok);
	if (!started.ok) return;
	writeFileSync(join(dir, "size.txt"), "4\n");
	const round = await settleRound(dir, started.state, 1);
	assert.equal(round.kept, true);
	assert.equal(round.targetReached, true);
});
