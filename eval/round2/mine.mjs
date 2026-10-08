#!/usr/bin/env node
// Mines round-2 tasks from the history of a repo: real fixes with tests, hard enough, with an issue that does not leak
// the fix. Usage: node mine.mjs --repo yaml|marked|zod [--want 10] [--max-commits 400]
// Writes/updates eval/round2/tasks.json. Needs network (gh api) — only here, never while agents run.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dropSharedIssues } from "./jobs.mjs";
import { REPOS } from "./repos.mjs";
import { stablePassing } from "./runners.mjs";

const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export function splitFiles(paths) {
	const tests = paths.filter((path) => TEST_PATH.test(path));
	return { source: paths.filter((path) => !tests.includes(path)), tests };
}

export const isHard = ({ sourceFiles, sourceLines }) => sourceFiles >= 2 || sourceLines > 20;

export function issueNumbers(message) {
	return [...new Set([...message.matchAll(/(?:^|[\s(])(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/g)].map((match) => Number(match[1])))];
}

export function leaksFix(issueText, fixDiff) {
	if (/```diff|^@@ /m.test(issueText)) return true;
	const added = fixDiff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1).trim()).filter((line) => line.length >= 25);
	return added.filter((line) => issueText.includes(line)).length >= 2;
}

/** Tests passing steadily with the fix (two runs), and among them the ones that did not pass before it. */
export function targetsFrom(before, after1, after2) {
	const expected = stablePassing(after1.passed, after2.passed);
	return { expected, targetTests: expected.filter((id) => !before.passed.includes(id)) };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
	const argument = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
	const repoName = argument("repo");
	const want = Number(argument("want", "10"));
	const maxCommits = Number(argument("max-commits", "400"));
	const repo = REPOS[repoName];
	if (!repo) throw new Error(`repo sconosciuto: ${repoName}`);
	const evalDir = new URL(".", import.meta.url).pathname;
	const tasksFile = join(evalDir, "tasks.json");
	const tasks = existsSync(tasksFile) ? JSON.parse(readFileSync(tasksFile, "utf8")) : [];
	const clone = join(homedir(), ".cache/pi-eval/repos", repoName);
	if (!existsSync(clone)) execSync(`git clone --quiet ${repo.url} ${JSON.stringify(clone)}`);
	const git = (command, cwd = clone) => execSync(`git ${command}`, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	const quote = (files) => files.map((file) => JSON.stringify(file)).join(" ");
	const ownerRepo = repo.url.replace("https://github.com/", "");
	const work = join(homedir(), ".cache/pi-eval/work2/mine", repoName);
	const runSuite = () => {
		let output;
		try {
			output = execSync(repo.testCommand(), { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000, maxBuffer: 256 * 1024 * 1024 });
		} catch (error) {
			output = error.stdout ?? "";
		}
		try {
			return repo.parse(output, work);
		} catch {
			return { passed: [], failed: [] };
		}
	};
	const findIssue = (numbers) => {
		const queue = [...numbers];
		for (let index = 0; index < queue.length && index < 6; index++) {
			try {
				const data = JSON.parse(execSync(`gh api repos/${ownerRepo}/issues/${queue[index]}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
				if (!data.pull_request && data.body) return { number: queue[index], title: data.title, body: data.body };
				// A PR: follow the issues it closes.
				if (data.pull_request) for (const linked of issueNumbers(data.body ?? "")) if (!queue.includes(linked)) queue.push(linked);
			} catch {
				// Not found / no access: try the next one.
			}
		}
		return undefined;
	};
	const prepare = (base) => {
		rmSync(work, { recursive: true, force: true });
		execSync(`git clone --quiet --shared ${JSON.stringify(clone)} ${JSON.stringify(work)}`);
		git(`checkout --quiet ${base}`, work);
		execSync(repo.install, { cwd: work, stdio: "ignore", timeout: 600_000 });
	};
	if (process.argv.includes("--revalidate")) {
		// Recompute target and expected tests of the existing tasks with two runs after the fix (flaky tests out).
		for (const task of tasks.filter((entry) => entry.repo === repoName && !entry.dropped)) {
			prepare(task.base);
			const source = splitFiles(git(`diff --name-only ${task.base} ${task.fix}`).trim().split("\n").filter(Boolean)).source.filter((file) => git(`ls-tree --name-only ${task.fix} -- ${JSON.stringify(file)}`).trim());
			git(`checkout --quiet ${task.fix} -- ${quote(task.hiddenTests)}`, work);
			const before = runSuite();
			git(`checkout --quiet ${task.fix} -- ${quote(source)}`, work);
			const { expected, targetTests } = targetsFrom(before, runSuite(), runSuite());
			Object.assign(task, { expected, targetTests });
			if (!targetTests.length) task.dropped = "test bersaglio instabili";
			writeFileSync(tasksFile, `${JSON.stringify(tasks, null, "\t")}\n`);
			console.log(`${task.id}: ${targetTests.length} bersaglio, ${expected.length} attesi${task.dropped ? ` — scartato: ${task.dropped}` : ""}`);
		}
		process.exit(0);
	}
	const found = tasks.filter((task) => task.repo === repoName && !task.dropped).length;
	let added = 0;
	for (const fix of git(`log --format=%H --no-merges -n ${maxCommits}`).trim().split("\n")) {
		if (found + added >= want) break;
		if (tasks.some((task) => task.fix === fix)) continue;
		const message = git(`log -1 --format=%B ${fix}`);
		if (!/\bfix/i.test(message)) continue;
		const numbers = issueNumbers(message);
		if (!numbers.length) continue;
		const { source, tests } = splitFiles(git(`diff --name-only ${fix}^ ${fix}`).trim().split("\n").filter(Boolean));
		if (!source.length || !tests.length) continue;
		const sourceLines = git(`diff --numstat ${fix}^ ${fix} -- ${quote(source)}`).trim().split("\n").reduce((sum, line) => sum + (Number(line.split("\t")[0]) || 0) + (Number(line.split("\t")[1]) || 0), 0);
		if (!isHard({ sourceFiles: source.length, sourceLines })) continue;
		const issue = findIssue(numbers);
		// An issue already used (or dropped): its other fixes would share the prompt.
		if (issue && tasks.some((task) => task.repo === repoName && task.issue.number === issue.number)) continue;
		if (!issue || leaksFix(`${issue.title}\n${issue.body}`, git(`diff ${fix}^ ${fix} -- ${quote(source)}`))) continue;
		// Validate on a clean checkout of the parent commit.
		try {
			prepare(`${fix}^`);
		} catch {
			continue;
		}
		const baseline = stablePassing(runSuite().passed, runSuite().passed);
		// Deleted test files have no version at the fix: only restore the ones that exist there.
		const hiddenTests = tests.filter((file) => git(`ls-tree --name-only ${fix} -- ${JSON.stringify(file)}`).trim());
		git(`checkout --quiet ${fix} -- ${quote(hiddenTests)}`, work);
		const before = runSuite();
		git(`checkout --quiet ${fix} -- ${quote(source.filter((file) => git(`ls-tree --name-only ${fix} -- ${JSON.stringify(file)}`).trim()))}`, work);
		const { expected, targetTests } = targetsFrom(before, runSuite(), runSuite());
		const broken = baseline.filter((id) => !expected.includes(id));
		if (!targetTests.length || broken.length || baseline.length < 20) {
			console.log(`- ${fix.slice(0, 7)} scartato: target ${targetTests.length}, rotti dalla correzione ${broken.length}, baseline ${baseline.length}`);
			continue;
		}
		tasks.push({ id: `${repoName}-${fix.slice(0, 7)}`, repo: repoName, base: git(`rev-parse ${fix}^`).trim(), fix, date: git(`log -1 --format=%cs ${fix}`).trim(), issue, hiddenTests, targetTests, expected, baseline, sourceFiles: source.length, sourceLines });
		added++;
		writeFileSync(tasksFile, `${JSON.stringify(dropSharedIssues(tasks), null, "\t")}\n`);
		console.log(`+ ${repoName}-${fix.slice(0, 7)} #${issue.number} ${source.length} file, ${sourceLines} righe, ${targetTests.length} test bersaglio — ${issue.title}`);
	}
	console.log(`${repoName}: ${found + added}/${want} compiti`);
}
