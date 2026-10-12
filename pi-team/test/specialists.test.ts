import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeRoles } from "../index.ts";
import { renderPlan, validatePlan, type TeamPlan } from "../src/plan.ts";
import { saveNewRoles, teamGuidance, uncoveredStacks, validateNewRoles, withNewRoles, type NewRoleSpec } from "../src/recruit.ts";
import { BUILT_IN_ROLES_DIRECTORY, loadRoles } from "../src/roles.ts";
import { detectDependencies, detectVersions, formatSpecialists, matchSpecialists } from "../src/stack.ts";

const roles = loadRoles([BUILT_IN_ROLES_DIRECTORY]);
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
const INSTALLED = ["node", "modules"].join("_");

test("specialists inherit the base role and add their expertise after its rules", () => {
	const react = roles.get("react-dev")!;
	const implementer = roles.get("implementer")!;
	assert.equal(react.extends, "implementer");
	assert.equal(react.writes, true);
	assert.deepEqual(react.tools, implementer.tools);
	assert.equal(react.model, implementer.model);
	assert.equal(react.maxInputTokens, implementer.maxInputTokens);
	assert.ok(react.instructions.startsWith(implementer.instructions), "general rules first");
	assert.match(react.instructions, /Competenze: React/);
	assert.deepEqual(roles.get("nest-dev")!.stack, ["@nestjs/*"]);
});

test("user roles override fields of a specialist and can extend user-overridden bases", () => {
	const user = temp("pi-team-roles-");
	writeFileSync(join(user, "implementer.md"), "---\nname: implementer\nmodel: opus\nwrites: true\n---\nRegole mie.");
	writeFileSync(join(user, "vue-dev.md"), "---\nname: vue-dev\ndescription: Vue\nextends: implementer\nstack: vue\nthinking: high\n---\nCompetenze Vue.");
	writeFileSync(join(user, "loop-a.md"), "---\nextends: loop-b\n---\na");
	writeFileSync(join(user, "loop-b.md"), "---\nextends: loop-a\n---\nb");
	const all = loadRoles([BUILT_IN_ROLES_DIRECTORY, user]);
	assert.equal(all.get("vue-dev")!.model, "opus", "inherits the overridden base");
	assert.equal(all.get("vue-dev")!.thinking, "high");
	assert.equal(all.get("vue-dev")!.instructions, "Regole mie.\n\nCompetenze Vue.");
	assert.equal(all.get("react-dev")!.model, "opus", "built-in specialists follow the user's base too");
	assert.ok(all.get("loop-a") && all.get("loop-b"), "a cycle does not break loading");
});

function project() {
	const root = temp("pi-team-project-");
	const write = (folder: string, manifest: object) => {
		mkdirSync(join(root, folder), { recursive: true });
		writeFileSync(join(root, folder, "package.json"), JSON.stringify(manifest));
	};
	write(".", { devDependencies: { typescript: "5" } });
	write("desktop", { dependencies: { electron: "30", react: "18", "react-dom": "18" } });
	write("apps/api", { dependencies: { "@nestjs/core": "10", "@nestjs/common": "10", prisma: "5" } });
	write("apps/web", { dependencies: { vue: "3" } });
	write(`${INSTALLED}/express`, { dependencies: { express: "4" } });
	return root;
}

test("the project's stack picks the specialists, with the folders where it was found", () => {
	const dependencies = detectDependencies(project());
	assert.deepEqual(dependencies.get("react"), ["desktop"]);
	assert.deepEqual(dependencies.get("@nestjs/core"), ["apps/api"]);
	assert.equal(dependencies.has("express"), false, "installed packages' own manifests are ignored");
	const found = matchSpecialists(roles, dependencies);
	assert.deepEqual(found.map((match) => match.role.name).sort(), ["electron-dev", "nest-dev", "react-dev"]);
	const text = formatSpecialists(found);
	assert.match(text, /- nest-dev: @nestjs\/core, @nestjs\/common in apps\/api\//);
	assert.match(text, /- react-dev: react, react-dom in desktop\//);
	assert.equal(formatSpecialists([]), "");
});

test("stacks no member covers are offered as new members, and covered ones are not", () => {
	const dependencies = detectDependencies(project());
	const gaps = uncoveredStacks(dependencies, roles);
	assert.deepEqual(gaps.map((gap) => gap.label).sort(), ["Prisma", "Vue"]);
	const guidance = teamGuidance(matchSpecialists(roles, dependencies), gaps, formatSpecialists);
	assert.match(guidance, /senza uno specialista nel team: Vue \(vue\), Prisma \(prisma\)/);
	assert.match(guidance, /newRoles/);
	const withVue = withNewRoles(roles, [{ name: "vue-dev", extends: "implementer", description: "Vue", stack: ["vue"], instructions: "x" }]);
	assert.ok(!uncoveredStacks(dependencies, withVue).some((gap) => gap.label === "Vue"));
});

const vue: NewRoleSpec = {
	name: "vue-dev",
	extends: "implementer",
	description: "Frontend Vue 3: Composition API, Pinia, Vue Router",
	stack: ["vue", "pinia"],
	instructions: "- Composition API con <script setup>.\n- Stato condiviso in Pinia, non in variabili globali.\n- Props tipizzate con defineProps; emit dichiarati.\n- Test con Vitest e @vue/test-utils.",
};
const task = (id: string, role: string) => ({ id, role, title: id, instructions: "Implementa la parte del lavoro descritta nell'obiettivo", files: [`${id}/`], verify: ["npm test"] });

test("a plan can recruit a specialist and use it in the same run", () => {
	const plan: TeamPlan = { goal: "g", tasks: [task("t1", "vue-dev"), task("t2", "nest-dev")], newRoles: [vue] };
	assert.deepEqual(validatePlan(plan, roles), []);
	assert.match(renderPlan(plan, roles), /Nuovi membri del team[\s\S]*\+ vue-dev \(implementer · vue, pinia\)[\s\S]*t1 \[vue-dev · sonnet\]/);
	assert.match(validatePlan({ ...plan, newRoles: undefined }, roles).join(), /unknown role "vue-dev"/);
});

test("new members are checked: name, base, expertise, no duplicates of existing members", () => {
	const problems = validateNewRoles([
		{ ...vue, name: "React Dev" },
		{ ...vue, name: "react-dev" },
		{ ...vue, name: "x-dev", extends: "ghost" },
		{ ...vue, name: "y-dev", instructions: "brevi" },
		{ ...vue, name: "z-dev", model: "gpt" },
	], roles).join("\n");
	assert.match(problems, /"React Dev": name must be lowercase/);
	assert.match(problems, /"react-dev" already exists/);
	assert.match(problems, /extends unknown role "ghost"/);
	assert.match(problems, /"y-dev": instructions too short/);
	assert.match(problems, /"z-dev": model must be/);
	assert.match(problems, /max 3 per plan/);
});

test("approved new members are saved as role files and load like any other, without overwriting", () => {
	const directory = temp("pi-team-recruit-");
	assert.deepEqual(saveNewRoles([vue], directory), [join(directory, "vue-dev.md")]);
	const text = readFileSync(join(directory, "vue-dev.md"), "utf8");
	assert.match(text, /^---\nname: vue-dev\ndescription: Frontend Vue 3[^\n]*\nextends: implementer\nstack: vue, pinia\norigin: aggiunto dal team il \d{4}-\d\d-\d\d\n---\n- Composition API/);
	const loaded = loadRoles([BUILT_IN_ROLES_DIRECTORY, directory]).get("vue-dev")!;
	assert.equal(loaded.writes, true);
	assert.match(loaded.instructions, /^Sei l'implementatore[\s\S]*Pinia/);
	writeFileSync(join(directory, "vue-dev.md"), "mio");
	assert.deepEqual(saveNewRoles([vue], directory), []);
	assert.equal(readFileSync(join(directory, "vue-dev.md"), "utf8"), "mio");
});

test("the tool description lists general roles, then specialists with base and stack", () => {
	const text = describeRoles(roles);
	assert.ok(text.indexOf("- implementer") < text.indexOf("Specialists"));
	assert.match(text, /- nest-dev \(sonnet, modifica file\): Backend NestJS[^\n]*\[implementer; @nestjs\/\*\]/);
});

test("every built-in specialist was checked against official docs, and says so", () => {
	const official = /^https:\/\/(www\.electronjs\.org|react\.dev|testing-library\.com|docs\.nestjs\.com|expressjs\.com)\//;
	for (const name of ["electron-dev", "express-dev", "nest-dev", "react-dev"]) {
		const role = roles.get(name)!;
		assert.match(role.verified ?? "", /^\d{4}-\d\d-\d\d su /, `${name}: verified date and version`);
		assert.ok((role.sources?.length ?? 0) >= 5, `${name}: sources`);
		for (const url of role.sources!) assert.match(url, official, `${name}: ${url}`);
		assert.match(role.instructions, /Prima di tutto leggi .*versione/, `${name}: checks the project's version first`);
		assert.ok(!role.instructions.includes("https://"), `${name}: sources stay out of the prompt`);
	}
});

test("version-dependent rules are split by major, as in the official docs", () => {
	const express = roles.get("express-dev")!.instructions;
	assert.match(express, /Express 5: se un handler[\s\S]*Express 4: gli errori asincroni vanno passati a mano/);
	assert.match(express, /\/\*splat/);
	assert.match(roles.get("electron-dev")!.instructions, /Non disattivare mai `contextIsolation` \(default dalla 12\) né `sandbox` \(default dalla 20\)/);
	assert.match(roles.get("react-dev")!.instructions, /Solo con React 19 \(non su 18\)/);
	assert.match(roles.get("nest-dev")!.instructions, /Dalla 12 i pacchetti sono solo ESM/);
});

test("the manager's hint carries the version ranges found in each package.json", () => {
	const root = project();
	const text = formatSpecialists(matchSpecialists(roles, detectDependencies(root), detectVersions(root)));
	assert.match(text, /- electron-dev: electron@30 in desktop\//);
	assert.match(text, /- nest-dev: @nestjs\/core@10, @nestjs\/common@10 in apps\/api\//);
	assert.match(text, /versione rilevata/);
});
