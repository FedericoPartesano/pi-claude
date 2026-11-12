// Checks of the docs and measurement requirements of the /auto screen batch (R9 report, R10 documentation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("R9: perf report with base measure and after-change median, verdict within +10% (or the negative result)", () => {
	const report = read("eval/ui/REPORT.md");
	const i = report.indexOf("### Schermata di auto");
	assert.ok(i >= 0, "section '### Schermata di auto' in eval/ui/REPORT.md");
	const sec = report.slice(i).split(/\n### /)[0];
	assert.match(sec, /5 giri/);
	assert.match(sec, /mediana/i);
	assert.match(sec, /prima.*\d/is, "base measure before the change");
	assert.match(sec, /dopo.*\d/is, "measure after the change");
	assert.match(sec, /\+?-?\d+([.,]\d+)?\s*%/, "relative change in percent");
	assert.match(sec, /entro il 10%|oltre il 10%/, "explicit verdict against the 10% limit");
	assert.match(sec, /perf\.test\.mjs/);
});

test("R10: documentation updated in the four places", () => {
	for (const p of ["prototype/rpc-chat/README.md", "README.md", "vault/wiki/entities/chat-rpc.md"]) {
		const t = read(p);
		assert.match(t, /RIVEDI/, `${p} mentions RIVEDI`);
		assert.match(t, /k di n|passo \d di \d|«k di n»/, `${p} describes 'k di n'`);
		assert.match(t, /esc/, `${p} describes esc`);
	}
	const log = read("vault/wiki/log.md");
	assert.match(log.split("\n## ").slice(0, 3).join("\n"), /schermata di auto|cockpit/i, "recent log entry");
	assert.match(read("vault/wiki/log.md").slice(0, 2500), /\[2026-11-12\]/);
});
