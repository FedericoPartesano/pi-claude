import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { overageActive } from "../quota.mjs";

test("overage is read from the usage file; missing or broken file means no overage", () => {
	const dir = mkdtempSync(join(tmpdir(), "quota-"));
	const file = join(dir, "usage.json");
	assert.equal(overageActive(file), false);
	writeFileSync(file, "{not json");
	assert.equal(overageActive(file), false);
	writeFileSync(file, JSON.stringify({ isUsingOverage: false }));
	assert.equal(overageActive(file), false);
	writeFileSync(file, JSON.stringify({ isUsingOverage: true }));
	assert.equal(overageActive(file), true);
});
