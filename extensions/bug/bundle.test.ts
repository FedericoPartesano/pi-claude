import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lastTodo, redactedCopy, slug, trimSession, writeBundle, type BugForm } from "./bundle.ts";
import { redact } from "./redact.ts";

test("redact: nasconde le forme di segreto più comuni e lascia stare il resto", () => {
	const cases: [string, RegExp][] = [
		["la password è Gattino!2024 ok", /Gattino/],
		["password: Fulmine123?", /Fulmine123/],
		["token sk-test-FAKE9a8b7c6d5e4f3a2b1c0d", /FAKE9a8b/],
		["mongodb+srv://test:Segreta99@cluster0.mongodb.net/?x=1", /Segreta99/],
		["Authorization: Bearer abcdefghijklmnopqrstuv0123456789", /abcdefghijklmnop/],
		["ghp_abcdefghijklmnopqrstuvwxyz0123456789", /ghp_abcdefghij/],
		["AKIAABCDEFGHIJKLMNOP", /AKIAABCDEF/],
		["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopq", /eyJhbGci/],
		["-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", /MIIabc/],
	];
	for (const [input, leaked] of cases) {
		const out = redact(input);
		assert.doesNotMatch(out, leaked, input);
		assert.match(out, /\[oscurato\]/, input);
	}
	assert.equal(redact("mongodb+srv://test:Segreta99@cluster0.mongodb.net").startsWith("mongodb+srv://test:[oscurato]@cluster0"), true);
	const plain = "Usa pnpm, test con node --test, file src/csv.js, porta 5433.";
	assert.equal(redact(plain), plain);
});

const form: BugForm = { title: "Todo spariti dopo compattazione!", happened: "lista vuota", expected: "10 task", severity: "blocca", redact: true, send: true };

function sources(root: string) {
	const cwd = join(root, "project");
	const home = join(root, "home");
	mkdirSync(join(cwd, ".pi/memory"), { recursive: true });
	mkdirSync(join(cwd, "intents"), { recursive: true });
	mkdirSync(join(home, ".pi/agent/memory"), { recursive: true });
	writeFileSync(join(cwd, ".pi/memory/memories.jsonl"), '{"id":"r1","text":"La password è Fulmine123"}\n');
	writeFileSync(join(cwd, "intents/a.md"), "# intent\nstatus: in-progress\n");
	writeFileSync(join(home, ".pi/agent/memory/memories.jsonl"), '{"id":"r1","text":"globale"}\n');
	const sessionFile = join(root, "s.jsonl");
	writeFileSync(sessionFile, '{"type":"session"}\n{"msg":"token sk-test-FAKE9a8b7c6d5e4f3a2b1c0d"}\n');
	const branch = [{ type: "message", message: { role: "toolResult", toolName: "todo", details: { tasks: [{ subject: "a", status: "pending" }], nextId: 2 } } }];
	const extensionRoot = join(root, "ext");
	mkdirSync(extensionRoot);
	writeFileSync(join(extensionRoot, "package.json"), '{"name":"pi-claude","version":"1.2.3"}');
	return { cwd, home, form, piVersion: "9.9.9", extensionRoot, model: "m", sessionId: "sid", sessionFile, branch, systemPrompt: "SYS", env: { PI_X: "1", PI_BUG_TOKEN: "segreto", PATH: "/usr/bin" }, now: new Date("2026-10-13T10:20:30Z") };
}

test("writeBundle: scrive tutto (sessione, ramo, memoria, intent, todo, report) senza toccare gli originali", () => {
	const root = mkdtempSync(join(tmpdir(), "bug-"));
	const dir = writeBundle(join(root, "out"), sources(root));
	assert.match(dir, /2026-10-13T10-20-30-todo-spariti-dopo-compattazione$/);
	for (const file of ["report.json", "branch.json", "todo.json", "system-prompt.txt", "session.jsonl", "memory/project/memory/memories.jsonl", "memory/global/memory/memories.jsonl", "intents/a.md"]) assert.ok(existsSync(join(dir, file)), file);
	const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
	assert.equal(report.form.happened, "lista vuota");
	assert.equal(report.pi, "9.9.9");
	assert.equal(report.extension.name, "pi-claude");
	assert.equal(report.extension.version, "1.2.3");
	assert.equal(report.extension.commit, undefined, "una cartella senza git non inventa un commit");
	assert.deepEqual(report.settings, { PI_X: "1", PI_BUG_TOKEN: "[nascosto]" });
	assert.match(readFileSync(join(dir, "session.jsonl"), "utf8"), /FAKE9a8b/, "la copia sul disco resta intera");
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "todo.json"), "utf8")).tasks.length, 1);
});

test("redactedCopy: stessa struttura, segreti nascosti ovunque nel testo", () => {
	const root = mkdtempSync(join(tmpdir(), "bug-"));
	const dir = writeBundle(join(root, "out"), sources(root));
	const copy = redactedCopy(dir);
	assert.equal(copy, `${dir}-oscurato`);
	assert.doesNotMatch(readFileSync(join(copy, "session.jsonl"), "utf8"), /FAKE9a8b/);
	assert.doesNotMatch(readFileSync(join(copy, "memory/project/memory/memories.jsonl"), "utf8"), /Fulmine123/);
	assert.match(readFileSync(join(copy, "intents/a.md"), "utf8"), /in-progress/);
	assert.match(readFileSync(join(dir, "session.jsonl"), "utf8"), /FAKE9a8b/);
});

test("slug e lastTodo", () => {
	assert.equal(slug("  Più così! "), "piu-cosi");
	assert.equal(slug("???"), "bug");
	assert.equal(lastTodo([]), undefined);
});

test("writeBundle: di crashes.json copia solo l'ultima settimana", () => {
	const root = mkdtempSync(join(tmpdir(), "bug-"));
	const s = sources(root);
	mkdirSync(join(s.home, ".pi/agent"), { recursive: true });
	const day = 86_400_000;
	const at = (days: number) => new Date(s.now.getTime() - days * day).toISOString();
	writeFileSync(join(s.home, ".pi/agent/crashes.json"), JSON.stringify([{ timestamp: at(30), message: "vecchio" }, { timestamp: at(2), message: "recente" }]));
	const dir = writeBundle(join(root, "out"), s);
	const kept = JSON.parse(readFileSync(join(dir, "crashes.json"), "utf8"));
	assert.deepEqual(kept.map((entry: { message: string }) => entry.message), ["recente"]);
});

test("trimSession: sopra il tetto tiene la coda del session.jsonl a righe intere, la cartella originale resta intera", () => {
	const dir = mkdtempSync(join(tmpdir(), "bug-trim-"));
	const lines = Array.from({ length: 200 }, (_, i) => JSON.stringify({ n: i, pad: "x".repeat(100) }));
	writeFileSync(join(dir, "session.jsonl"), lines.join("\n") + "\n");
	writeFileSync(join(dir, "report.json"), "{}");
	assert.equal(trimSession(dir, 1_000_000), dir, "sotto il tetto non si copia nulla");
	const out = trimSession(dir, 5_000);
	assert.equal(out, `${dir}-ridotto`);
	const kept = readFileSync(join(out, "session.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(kept[0].type, "troncato");
	assert.ok(kept[0].omittedBytes > 0);
	assert.equal(kept[kept.length - 1].n, 199, "l'ultima riga c'è");
	assert.ok(statSync(join(out, "session.jsonl")).size <= 5_500);
	assert.equal(readFileSync(join(dir, "session.jsonl"), "utf8").trim().split("\n").length, 200, "l'originale resta intero");
	assert.ok(existsSync(join(out, "report.json")));
});
