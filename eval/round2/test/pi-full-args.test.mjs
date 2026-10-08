import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { piFullExtensionArgs } from "../pi-full-args.mjs";

const repo = join(new URL(".", import.meta.url).pathname, "../../..");

test("pi-full extensions come from bin/pi-full, with $A and $REPO resolved", () => {
	const args = piFullExtensionArgs(repo, "/agent");
	assert.equal(args.length % 2, 0);
	assert.ok(args.filter((_, index) => index % 2 === 0).every((flag) => flag === "-e"));
	const paths = args.filter((_, index) => index % 2 === 1);
	assert.ok(paths.includes(join(repo, "pi-team")));
	assert.ok(paths.includes("/agent/optional-extensions/subagent"));
	assert.ok(paths.at(-1).endsWith("extensions/tool-groups.ts"), "tool-groups stays last");
});
