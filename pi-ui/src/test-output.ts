/**
 * Reads test runner output (node:test, jest, vitest, pytest). The model often pipes it through tail/grep, which hides the
 * exit code, so the pass/fail counts decide too.
 */
export function checkOutcome(text: string, isError: boolean, isTestRun = false): { failed: boolean; pass?: number; fail?: number } {
	const number = (pattern: RegExp) => {
		const match = pattern.exec(text);
		return match ? Number(match[1]) : undefined;
	};
	const fail = number(/(?:ℹ|#) fail (\d+)/) ?? number(/Tests?:?\s+(\d+) failed/) ?? number(/(\d+) failed(?:,| in)/);
	const pass = number(/(?:ℹ|#) pass (\d+)/) ?? number(/(\d+) passed/);
	// A test run cut by tail/grep may show only the assertion error: for test commands that is a failure too.
	const assertion = isTestRun && fail === undefined && /AssertionError|ERR_ASSERTION|✖ failing tests|^\s*FAIL\s|\d+ failing\b/m.test(text);
	const outcome: { failed: boolean; pass?: number; fail?: number } = { failed: isError || (fail ?? 0) > 0 || assertion };
	if (pass !== undefined) outcome.pass = pass;
	if (fail !== undefined) outcome.fail = fail;
	return outcome;
}

/** Failing tests as "name · place · ricevuto X, atteso Y" (parts that cannot be found are left out). */
export function failingTests(text: string): string[] {
	const failures: string[] = [];
	// pytest: one line per failure with place and message.
	for (const match of text.matchAll(/^FAILED (\S+?)::(\S+)(?: - (.+))?$/gm)) failures.push([match[2], match[1], match[3]].filter(Boolean).join(" · "));
	if (failures.length) return failures;

	const names = [...new Set([
		...[...text.matchAll(/^\s*(?:✖|✕|×)\s+(?!failing tests)(.+?)(?:\s+\([\d.]+\s*m?s\))?\s*$/gm)].map((match) => match[1]),
		...[...text.matchAll(/^\s*●\s+(.+?)\s*$/gm)].map((match) => match[1]),
		...[...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]),
	])];
	const places = [...text.matchAll(/(?:test at |\()((?:[\w.-]+\/)*[\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?):(\d+)/g)].map((match) => `${match[1]}:${match[2]}`);
	const values = [
		...[...text.matchAll(/^\s*(\S.*?)\s+!==\s+(\S.*?)\s*$/gm)].map((match) => `ricevuto ${match[1]}, atteso ${match[2]}`),
		...[...text.matchAll(/Expected:\s*(.+)\n\s*Received:\s*(.+)/g)].map((match) => `ricevuto ${match[2].trim()}, atteso ${match[1].trim()}`),
		...[...text.matchAll(/actual: (.+?),?\n\s*expected: (.+?),?(?:\n|$)/g)].map((match) => `ricevuto ${match[1]}, atteso ${match[2]}`),
	];
	// Only the error object is visible (output cut by tail): report the values alone.
	if (names.length === 0) return [...new Set(values)];
	names.forEach((name, index) => failures.push([name, places[index], values[index]].filter(Boolean).join(" · ")));
	return failures;
}
