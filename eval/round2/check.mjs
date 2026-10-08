// Verdict of a round-2 task: with the fix's test files restored over whatever the agent wrote, every target test (one
// that passes only with the real fix) must pass, and every other test passing steadily with the fix (expected; the
// baseline for older tasks) must still pass.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function checkTask(dir, task, repo, fixFiles) {
	for (const path of task.hiddenTests) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), fixFiles(path));
	}
	let results;
	try {
		let output;
		try {
			output = execSync(repo.testCommand(), { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000, maxBuffer: 256 * 1024 * 1024 });
		} catch (error) {
			if (error.signal) throw error;
			output = error.stdout ?? "";
		}
		results = repo.parse(output, dir);
	} catch {
		return { pass: false, reason: "suite in errore o timeout", hiddenFailed: [], regressions: [] };
	}
	const hiddenFailed = task.targetTests.filter((id) => !results.passed.includes(id));
	// expected (stable over two runs after the fix) also covers new hidden tests that already passed before it.
	const required = task.expected ?? task.baseline;
	const regressions = required.filter((id) => !task.targetTests.includes(id) && !results.passed.includes(id));
	const reason = hiddenFailed.length ? `test nascosti falliti: ${hiddenFailed.length}` : regressions.length ? `regressioni: ${regressions.length}` : "ok";
	return { pass: reason === "ok", reason, hiddenFailed, regressions };
}
