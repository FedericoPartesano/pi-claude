import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionsProtectedPath, protectedPathModifiedBy } from "./protected-paths.ts";

test("blocks bash writes to protected paths", () => {
	for (const command of [
		"sed -i 's/a/b/' .env",
		"sed -Ei 's/a/b/' config/.env.production",
		"echo X=1 >> .env",
		"cat new > ./.env",
		"cp .env.example .env",
		"mv tmp .env",
		"rm -rf .git/hooks",
		"tee .env < input",
		"python3 -c \"open('.env','w').write('x')\"",
		"rm -rf node_modules/foo",
	]) assert.ok(protectedPathModifiedBy(command), command);
});

test("allows reads and unrelated commands", () => {
	for (const command of [
		"cat .env",
		"grep API_TOKEN .env",
		"git log --oneline",
		"echo $NODE_ENV > out.txt",
		"sed -i 's/process.env.X/Y/' src/app.js",
		"ls node_modules",
		"npm test",
		"ls node_modules 2>&1",
		"grep -r x node_modules/pkg 2>&1 | head",
	]) assert.equal(protectedPathModifiedBy(command), undefined, command);
});

test("write/edit path matching", () => {
	assert.ok(mentionsProtectedPath(".env"));
	assert.ok(mentionsProtectedPath("apps/x/.env.development"));
	assert.equal(mentionsProtectedPath("src/env.ts"), undefined);
	assert.equal(mentionsProtectedPath("src/process.env.ts"), undefined);
});
