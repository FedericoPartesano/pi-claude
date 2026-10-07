import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkFileRefs, vscodeUrl } from "../src/answer.ts";

test("file:line references to existing files become VS Code links; code blocks and unknown files stay as they are", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-ui-ans-"));
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src/cart.js"), "x");
	const markdown = "Ho corretto `totalValue` in src/cart.js:5 e anche src/cart.js.\n\n```\nsrc/cart.js:5\n```\nNon esiste: src/ghost.js:3";
	const linked = linkFileRefs(markdown, dir, (path, line) => `vscode://file${path}:${line}`);
	assert.match(linked, new RegExp(`\\[src/cart.js:5\\]\\(vscode://file${dir}/src/cart.js:5\\)`));
	assert.match(linked, /e anche \[src\/cart.js\]\(vscode:\/\/file.*src\/cart.js:1\)\./);
	assert.match(linked, /```\nsrc\/cart.js:5\n```/);
	assert.match(linked, /src\/ghost.js:3$/);
});

test("vscodeUrl targets the WSL remote when a distro is known", () => {
	assert.equal(vscodeUrl("/home/u/a.js", 5, "Ubuntu"), "vscode://vscode-remote/wsl+Ubuntu/home/u/a.js:5");
	assert.equal(vscodeUrl("/home/u/a.js", 5, undefined), "vscode://file/home/u/a.js:5");
});
