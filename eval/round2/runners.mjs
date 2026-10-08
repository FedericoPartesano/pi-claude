// Test results of the repos' own runners, as stable "file › full name" ids for baseline comparisons.
import { relative } from "node:path";

function parseAssertionJson(json, root) {
	const data = JSON.parse(json);
	const passed = [];
	const failed = [];
	for (const file of data.testResults ?? []) {
		const name = relative(root, file.name);
		for (const assertion of file.assertionResults ?? []) {
			const id = `${name} › ${assertion.fullName}`;
			if (assertion.status === "passed") passed.push(id);
			else if (assertion.status === "failed") failed.push(id);
		}
	}
	return { passed, failed };
}

export const parseJest = parseAssertionJson;
export const parseVitest = parseAssertionJson;

/** node --test TAP: ids are the subtest path (TAP does not name the file). */
export function parseTap(text) {
	const passed = [];
	const failed = [];
	const stack = [];
	for (const line of text.split("\n")) {
		const subtest = /^(\s*)# Subtest: (.*)$/.exec(line);
		if (subtest) {
			const depth = subtest[1].length / 4;
			stack.length = depth;
			stack[depth] = subtest[2];
			continue;
		}
		const result = /^(\s*)(ok|not ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO).*)?$/i.exec(line);
		if (!result || result[4]) continue;
		const depth = result[1].length / 4;
		const id = [...stack.slice(0, depth), result[3]].join(" › ");
		(result[2] === "ok" ? passed : failed).push(id);
	}
	return { passed, failed };
}

export const stablePassing = (runA, runB) => runA.filter((id) => runB.includes(id));
