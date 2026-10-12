import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PARALLEL, decideBudget, maxParallel } from "../src/budget.ts";
import { renderPlan, validatePlan, type TeamPlan } from "../src/plan.ts";
import { BUILT_IN_ROLES_DIRECTORY, loadRoles, parseRole } from "../src/roles.ts";

const roles = loadRoles([BUILT_IN_ROLES_DIRECTORY]);

test("built-in roles load with expected models and write flags", () => {
	assert.deepEqual([...roles.keys()].sort(), ["analyst", "debugger", "documenter", "electron-dev", "express-dev", "implementer", "nest-dev", "react-dev", "reviewer", "scout", "tester"]);
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
			{ id: "a", role: "implementer", title: "a", instructions: "Crea src/cart.js con addToCart e removeFromCart", files: ["src/cart.js"], verify: ["npm test"] },
			{ id: "b", role: "tester", title: "b", instructions: "Scrivi test/cart.test.js per addToCart e removeFromCart", files: ["test/"], dependsOn: ["a"], verify: ["npm test"] },
		],
	};
	assert.deepEqual(validatePlan(good, roles), []);
	assert.match(renderPlan(good, roles), /a \[implementer · sonnet\] a[\s\S]*verifica: npm test/);
});

test("validatePlan rejects a one-task plan: the team only pays off with separable tasks", () => {
	const single: TeamPlan = { goal: "g", tasks: [{ id: "a", role: "implementer", title: "a", instructions: "x", verify: ["npm test"] }] };
	assert.match(validatePlan(single, roles).join(), /one task.*yourself/);
});

test("validatePlan asks for self-contained instructions, declared files for writers, and a bounded size", () => {
	const long = "Istruzioni complete: cosa fare, dove e quando è finito";
	const plan: TeamPlan = {
		goal: "g",
		tasks: [
			{ id: "a", role: "implementer", title: "a", instructions: "fai a", verify: ["npm test"] },
			{ id: "b", role: "scout", title: "b", instructions: long },
		],
	};
	const problems = validatePlan(plan, roles).join("\n");
	assert.match(problems, /"a": instructions are too short/);
	assert.match(problems, /"a" \(implementer\) changes files but declares no `files`/);
	assert.doesNotMatch(problems, /"b"/, "read-only roles need no files");
	const huge: TeamPlan = { goal: "g", tasks: Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, role: "scout", title: "x", instructions: long })) };
	assert.match(validatePlan(huge, roles).join(), /13 tasks \(max 12\)/);
});

test("roles carry an input token cap", () => {
	assert.equal(parseRole("---\nmaxInputTokens: 50000\n---\nx", "r").maxInputTokens, 50000);
	assert.equal(parseRole("x", "r").maxInputTokens, undefined);
	assert.ok((roles.get("scout")?.maxInputTokens ?? Infinity) < (roles.get("implementer")?.maxInputTokens ?? 0));
});

test("decideBudget: aggressive until 80% of the 5h window, then slows down, stops at 95% or on extra usage", () => {
	const at = (usage: Parameters<typeof decideBudget>[0]) => decideBudget(usage, 8).concurrency;
	assert.equal(at(undefined), 4);
	assert.equal(at({ fiveHourUtilization: 0.2 }), 8);
	assert.equal(at({ fiveHourUtilization: 0.79 }), 8);
	assert.equal(at({ fiveHourUtilization: 0.8 }), 3);
	assert.equal(at({ fiveHourUtilization: 0.9 }), 1);
	assert.equal(at({ fiveHourUtilization: 0.95 }), 0);
	assert.equal(at({ fiveHourUtilization: 0.1, isUsingOverage: true }), 0);
	assert.equal(decideBudget({ fiveHourUtilization: 0.2 }, 5).concurrency, 5);
	assert.match(decideBudget({ fiveHourUtilization: 0.2 }, 8).reason, /finestra 5h al 20%: fino a 8 agenti/);
	assert.equal(maxParallel({ PI_PARALLEL_MAX: "6" }), 6);
	assert.equal(maxParallel({ PI_PARALLEL_MAX: "zero" }), MAX_PARALLEL);
});
