import { test } from "node:test";
import assert from "node:assert/strict";
import { bashPhrase, phrase, splitCommand } from "../src/phrases.ts";

test("splitCommand splits on && || ; | outside quotes and ignores heredoc bodies", () => {
	assert.deepEqual(splitCommand("sed -i 's|a; b|c|' x.js && npm test"), ["sed -i 's|a; b|c|' x.js", "npm test"]);
	assert.deepEqual(splitCommand("npm test 2>&1 | tail -20"), ["npm test 2>&1", "tail -20"]);
	assert.deepEqual(splitCommand("cat > a.js <<EOF\nx; y\nEOF"), ["cat > a.js <<EOF"]);
	assert.deepEqual(splitCommand("a || b ; c"), ["a", "b", "c"]);
});

test("bashPhrase names what a command does", () => {
	const cases: [string, string][] = [
		["sed -i 's|a; b|c|' src/inventory.js && npm test", "Modifico inventory.js e eseguo i test"],
		["cat src/inventory.js", "Leggo inventory.js"],
		["npm test 2>&1 | tail -20", "Eseguo i test"],
		["npm test 2>&1 | grep -E 'fail|pass'", "Eseguo i test"],
		["git add -A && git commit -m fix", "Faccio il commit"],
		["git status", "Controllo git"],
		["ls src && grep -rn findByTag src", "Cerco nel progetto"],
		["cat > test/cart.test.js <<EOF\nx\nEOF", "Scrivo cart.test.js"],
		["npm run build && npm test", "Eseguo build e test"],
		["npx tsc -p .", "Eseguo typecheck"],
		["python3 scripts/stats.py", "Eseguo stats.py"],
		["npm ci", "Installo le dipendenze"],
		["docker compose up -d", "Eseguo docker"],
	];
	for (const [command, expected] of cases) assert.equal(bashPhrase(command), expected, command);
});

test("phrase covers Pi's and pi-full's tools, also while arguments are still streaming", () => {
	assert.deepEqual(phrase("read", { path: "src/cart.js" }), { text: "Leggo cart.js", arg: "src/cart.js" });
	assert.equal(phrase("edit", {}).text, "Modifico…");
	assert.equal(phrase("write", { path: "a/b.ts" }).text, "Scrivo b.ts");
	assert.equal(phrase("bash", { command: "npm test" }).arg, "npm test");
	assert.equal(phrase("web_search", { query: "pi tui" }).text, "Cerco sul web");
	assert.equal(phrase("team", { goal: "x" }).text, "Lavoro con il team");
	assert.equal(phrase("load_tools", { groups: ["web"] }).text, "Carico web");
	assert.equal(phrase("mcp__thing_do_stuff", { a: 1 }).text, "mcp thing do stuff");
});

test("an edit whose JSON arguments did not parse still names its file", () => {
	assert.equal(phrase("edit", { __unparsedToolInput: '{"path": "src/pagination.js", "edits": [{"oldText":"\\tconst' }).text, "Modifico pagination.js");
});
