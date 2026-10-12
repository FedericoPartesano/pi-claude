import { test } from "node:test";
import assert from "node:assert/strict";
import { describeUpdates } from "./updates.ts";
// @ts-expect-error plain JS module
import { compareVersions, foldersToInstall, parseCounts } from "../bin/pi-update.mjs";

test("compareVersions: numeric, not alphabetical", () => {
	assert.equal(compareVersions("1.10.0", "1.9.2"), 1);
	assert.equal(compareVersions("1.0.4", "1.1.0"), -1);
	assert.equal(compareVersions("v1.0.4", "1.0.4"), 0);
	assert.equal(compareVersions("1.1", "1.1.0"), 0);
	assert.equal(compareVersions("2.0.0-beta.1", "1.9.9"), 1);
});

test("parseCounts: ahead and behind from rev-list", () => {
	assert.deepEqual(parseCounts("3\t1\n"), { ahead: 3, behind: 1 });
	assert.deepEqual(parseCounts(""), { ahead: 0, behind: 0 });
});

test("foldersToInstall: only the folders whose package.json or lock changed", () => {
	const folders = [".", "pi-ui", "pi-memory"];
	assert.deepEqual(foldersToInstall(["README.md", "pi-ui/package.json", "pi-ui/index.ts"], folders), ["pi-ui"]);
	assert.deepEqual(foldersToInstall(["package-lock.json", "pi-memory/package-lock.json"], folders), [".", "pi-memory"]);
	assert.deepEqual(foldersToInstall(["extensions/voice.ts"], folders), []);
});

test("describeUpdates: asks only when something is new and nothing local gets in the way", () => {
	assert.equal(describeUpdates({}), undefined);
	assert.equal(describeUpdates({ claude: { branch: "main", behind: 0, ahead: 0, subjects: [] }, pi: { current: "1.0.4", latest: "1.0.4", newer: false } }), undefined);
	assert.equal(describeUpdates({ claude: { branch: "main", behind: 2, ahead: 1, subjects: ["x"] } }), undefined);
	const text = describeUpdates({ claude: { branch: "main", behind: 2, ahead: 0, subjects: ["fix a", "feat b"] }, pi: { current: "1.0.4", latest: "1.1.0", newer: true } })!;
	assert.match(text, /pi-claude: 2 novità\n {3}· fix a\n {3}· feat b\nPi: 1\.0\.4 → 1\.1\.0\n\nAggiorno adesso/);
	assert.match(describeUpdates({ claude: { branch: "main", behind: 1, ahead: 0, subjects: [] } })!, /^pi-claude: 1 novità/);
});
