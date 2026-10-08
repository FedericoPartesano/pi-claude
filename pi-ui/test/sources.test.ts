import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeIntent, planFromBranch, planFromDetails } from "../src/sources.ts";

test("the todo plan from the tool's details, and the last one on the branch wins", () => {
	const details = { tasks: [{ id: 1, subject: "Scrivi i test", status: "completed" }, { id: 2, subject: "Correggi", status: "in_progress" }, { id: 3, subject: "Vecchio", status: "deleted" }], nextId: 4 };
	assert.deepEqual(planFromDetails(details), [{ subject: "Scrivi i test", status: "completed" }, { subject: "Correggi", status: "in_progress" }]);
	assert.equal(planFromDetails({ foo: 1 }), undefined);
	const branch = [
		{ type: "message", message: { role: "toolResult", toolName: "todo", details: { tasks: [{ subject: "a", status: "pending" }], nextId: 2 } } },
		{ type: "message", message: { role: "toolResult", toolName: "bash", details: {} } },
		{ type: "message", message: { role: "toolResult", toolName: "todo", details: { tasks: [{ subject: "b", status: "completed" }], nextId: 3 } } },
	];
	assert.deepEqual(planFromBranch(branch), [{ subject: "b", status: "completed" }]);
	assert.equal(planFromBranch([]), undefined);
});

test("the in-progress intent of the project: title and expected outcomes", () => {
	const dir = mkdtempSync(join(tmpdir(), "intents-"));
	mkdirSync(join(dir, "intents"));
	writeFileSync(join(dir, "intents/2026-10-01-vecchio.md"), "---\nstatus: done\n---\n# Intent: vecchio\n");
	writeFileSync(join(dir, "intents/2026-10-08-sconti.md"), "---\nstatus: in-progress\ncreated: 2026-10-08\n---\n# Intent: Sconti nel carrello\n\n## Outcome atteso\n- codice LIBRI10\n- test verdi\n\n## Vincoli\n- nessuno\n");
	assert.deepEqual(activeIntent(dir), { file: "intents/2026-10-08-sconti.md", title: "Sconti nel carrello", outcomes: ["codice LIBRI10", "test verdi"] });
	assert.equal(activeIntent(mkdtempSync(join(tmpdir(), "none-"))), undefined);
});
