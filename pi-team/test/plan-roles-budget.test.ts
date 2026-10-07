import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBudget } from "../src/budget.ts";
import { renderPlan, validatePlan, type TeamPlan } from "../src/plan.ts";
import { BUILT_IN_ROLES_DIRECTORY, loadRoles, parseRole } from "../src/roles.ts";

const roles = loadRoles([BUILT_IN_ROLES_DIRECTORY]);

test("built-in roles load with expected models and write flags", () => {
	assert.deepEqual([...roles.keys()].sort(), ["implementer", "reviewer", "scout", "tester"]);
	assert.equal(roles.get("scout")?.model, "haiku");
	assert.equal(roles.get("implementer")?.writes, true);
	assert.equal(roles.get("reviewer")?.writes, false);
	assert.deepEqual(roles.get("scout")?.tools, ["read", "bash"]);
});

test("parseRole defaults", () => {
	const role = parseRole("solo istruzioni", "x");
	assert.equal(role.name, "x");
	assert.equal(role.model, "sonnet");
	assert.equal(role.instructions, "solo istruzioni");
});

test("validatePlan catches structural problems", () => {
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "a", role: "implementer", title: "a", instructions: "x", dependsOn: ["b"] },
			{ id: "b", role: "scout", title: "b", instructions: "x", dependsOn: ["a"] },
			{ id: "b", role: "ghost", title: "c", instructions: "" },
		],
	};
	const problems = validatePlan(plan, roles).join("\n");
	assert.match(problems, /duplicate task id "b"/);
	assert.match(problems, /unknown role "ghost"/);
	assert.match(problems, /instructions are empty/);
	assert.match(problems, /no verify command/);
});

test("validatePlan detects cycles and accepts a good plan", () => {
	const cyclic: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "a", role: "scout", title: "a", instructions: "x", dependsOn: ["b"] },
			{ id: "b", role: "scout", title: "b", instructions: "x", dependsOn: ["a"] },
		],
	};
	assert.match(validatePlan(cyclic, roles).join(), /dependency cycle/);
	const good: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "a", role: "implementer", title: "a", instructions: "x", verify: ["npm test"] },
			{ id: "b", role: "tester", title: "b", instructions: "x", dependsOn: ["a"], verify: ["npm test"] },
		],
	};
	assert.deepEqual(validatePlan(good, roles), []);
	assert.match(renderPlan(good, roles), /a \[implementer · sonnet\] a[\s\S]*verifica: npm test/);
});

test("validatePlan rejects a one-task plan: the team only pays off with separable tasks", () => {
	const single: TeamPlan = { goal: "g", tasks: [{ id: "a", role: "implementer", title: "a", instructions: "x", verify: ["npm test"] }] };
	assert.match(validatePlan(single, roles).join(), /one task.*yourself/);
});

test("roles carry an input token cap", () => {
	assert.equal(parseRole("---\nmaxInputTokens: 50000\n---\nx", "r").maxInputTokens, 50000);
	assert.equal(parseRole("x", "r").maxInputTokens, undefined);
	assert.ok((roles.get("scout")?.maxInputTokens ?? Infinity) < (roles.get("implementer")?.maxInputTokens ?? 0));
});

test("decideBudget thresholds", () => {
	assert.equal(decideBudget(undefined).concurrency, 2);
	assert.equal(decideBudget({ fiveHourUtilization: 0.2 }).concurrency, 3);
	assert.equal(decideBudget({ fiveHourUtilization: 0.6 }).concurrency, 2);
	assert.equal(decideBudget({ fiveHourUtilization: 0.8 }).concurrency, 1);
	assert.equal(decideBudget({ fiveHourUtilization: 0.95 }).concurrency, 0);
	assert.equal(decideBudget({ fiveHourUtilization: 0.1, isUsingOverage: true }).concurrency, 0);
});
