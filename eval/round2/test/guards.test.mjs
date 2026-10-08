import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { claudeArgs, usageRecord } from "../../harness.mjs";
import { agentEnvironment, auditTranscript, isInfraFailure, memoryStoresFor } from "../guards.mjs";
import { piFullExtensionArgs } from "../pi-full-args.mjs";

const repo = join(new URL(".", import.meta.url).pathname, "../../..");

test("no web for either harness: Claude Code web tools disallowed, Pi without pi-web-access", () => {
	const args = claudeArgs("opus", { effort: "high", noWeb: true });
	assert.equal(args[args.indexOf("--disallowedTools") + 1], "WebFetch,WebSearch");
	assert.equal(args[args.indexOf("--effort") + 1], "high");
	const allowed = args[args.indexOf("--allowedTools") + 1];
	for (const tool of ["Bash(npx:*)", "Bash(tsc:*)", "Bash(rm:*)", "Bash(cd:*)"]) assert.ok(allowed.includes(tool), tool);
	assert.ok(!claudeArgs("opus", {}).includes("--disallowedTools"), "round 1 unchanged");
	const pi = piFullExtensionArgs(repo, "/agent", { exclude: ["pi-web-access"] });
	assert.ok(!pi.some((arg) => arg.includes("pi-web-access")));
	assert.ok(pi.some((arg) => arg.includes("tool-groups")));
});

test("agents run with git limited to local repos, npm offline and gh without credentials", () => {
	const env = agentEnvironment("/tmp/empty-gh");
	assert.equal(env.GIT_ALLOW_PROTOCOL, "file");
	assert.equal(env.npm_config_offline, "true");
	assert.equal(env.GH_CONFIG_DIR, "/tmp/empty-gh");
});

test("the transcript audit flags network and out-of-tree access", () => {
	assert.deepEqual(auditTranscript('{"command":"npm test"} {"command":"git diff"}'), []);
	for (const leak of ["gh api repos/eemeli/yaml/issues/660", "curl https://github.com/eemeli/yaml", "git fetch https://github.com/x", "npm pack yaml@latest", "cat ~/.cache/pi-eval/repos/yaml/src/a.ts", "cat eval/round2/tasks.json", "ls ../work2/mine", "WebFetch"]) {
		assert.ok(auditTranscript(leak).length > 0, leak);
	}
});

test("infrastructure failures are told apart from an agent's failure", () => {
	assert.equal(isInfraFailure({ requests: 0, errors: [] }), true);
	assert.equal(isInfraFailure({ requests: 3, errors: ["process exited: boom"] }), true);
	assert.equal(isInfraFailure({ requests: 5, errors: ["result error: error_during_execution Claude AI usage limit reached"] }), true);
	assert.equal(isInfraFailure({ requests: 4, errors: ["[error] 529 overloaded_error"] }), true);
	assert.equal(isInfraFailure({ requests: 12, errors: [] }), false);
	assert.equal(isInfraFailure({ requests: 12, errors: ["[error] This operation was aborted"], timedOut: true }), false, "a timeout is the agent's");
});

test("Claude Code's rate-limit records update the shared usage file like the bridge does", () => {
	const record = usageRecord({ isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 0.4 }, seven_day: { utilization: 0.2 } } });
	assert.equal(record.isUsingOverage, true);
	assert.equal(record.fiveHourUtilization, 0.4);
	assert.ok(record.updatedAt);
});

test("the per-path memory stores of both harnesses", () => {
	const stores = memoryStoresFor("/home/u/.cache/pi-eval/work2/run/x", "/home/u");
	assert.deepEqual(stores, ["/home/u/.claude/projects/-home-u--cache-pi-eval-work2-run-x", "/home/u/.pi/agent/sessions/--home-u-.cache-pi-eval-work2-run-x--"]);
});
